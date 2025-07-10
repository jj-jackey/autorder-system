const { createClient } = require('@supabase/supabase-js');

// Supabase 클라이언트 초기화 (타임아웃 설정 추가)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    global: {
      fetch: (url, options = {}) => {
        return fetch(url, {
          ...options,
          timeout: 60000, // 60초 타임아웃
        });
      }
    }
  }
);

/**
 * 파일을 Supabase Storage에 업로드 (강화된 재시도 로직)
 * @param {Buffer} fileBuffer - 파일 버퍼
 * @param {string} fileName - 파일명
 * @param {string} bucket - 버킷명 (기본값: 'uploads')
 * @param {number} maxRetries - 최대 재시도 횟수 (기본값: 5)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function uploadFile(fileBuffer, fileName, bucket = 'uploads', maxRetries = 5) {
  // 파일 확장자에 따른 MIME 타입 설정
  const getContentType = (fileName) => {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'xls':
        return 'application/vnd.ms-excel';
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      default:
        return 'application/octet-stream';
    }
  };

  let lastError = null;
  let consecutiveFailures = 0;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📤 Supabase Storage 업로드 시도 ${attempt}/${maxRetries}:`, {
        fileName,
        fileSize: fileBuffer.length,
        bucket
      });
      
      // 연속 실패 시 더 긴 대기 (서킷 브레이커 패턴)
      if (consecutiveFailures >= 2) {
        const circuitDelay = Math.min(5000 + consecutiveFailures * 2000, 15000);
        console.log(`🔄 서킷 브레이커: ${circuitDelay}ms 대기 중...`);
        await new Promise(resolve => setTimeout(resolve, circuitDelay));
      }
      
      // Promise.race를 사용한 타임아웃 제어
      const uploadPromise = supabase.storage
        .from(bucket)
        .upload(`files/${fileName}`, fileBuffer, {
          cacheControl: '3600',
          upsert: false,
          contentType: getContentType(fileName)
        });
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upload timeout after 60 seconds')), 60000);
      });
      
      const { data, error } = await Promise.race([uploadPromise, timeoutPromise]);

      if (error) {
        lastError = error;
        consecutiveFailures++;
        console.error(`❌ Supabase 업로드 오류 (시도 ${attempt}):`, {
          error: error.message,
          status: error.status || error.statusCode,
          consecutiveFailures
        });
        
        // 504, 503, 502, 타임아웃, 네트워크 오류인 경우 재시도
        const shouldRetry = attempt < maxRetries && (
          error.message.includes('504') || 
          error.message.includes('503') || 
          error.message.includes('502') || 
          error.message.includes('Gateway Timeout') || 
          error.message.includes('Bad Gateway') ||
          error.message.includes('Service Unavailable') ||
          error.message.includes('timeout') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('fetch failed') ||
          (error.status >= 500 && error.status < 600)
        );
        
        if (shouldRetry) {
          // 지수 백오프 + 지터 (최대 20초)
          const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          const jitter = Math.random() * 1000; // 0-1초 랜덤
          const delay = baseDelay + jitter;
          
          console.log(`🔄 ${Math.round(delay)}ms 후 재시도... (연속실패: ${consecutiveFailures})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } else {
          // 재시도하지 않는 오류인 경우
          console.error(`❌ 재시도 불가능한 오류:`, error.message);
          return { success: false, error: error.message };
        }
      }

      console.log(`✅ Supabase 업로드 성공 (시도 ${attempt}):`, {
        path: data.path,
        fileSize: fileBuffer.length
      });
      
      consecutiveFailures = 0; // 성공 시 실패 카운터 리셋
      return { success: true, data };
      
    } catch (error) {
      lastError = error;
      consecutiveFailures++;
      console.error(`❌ 업로드 예외 오류 (시도 ${attempt}):`, {
        error: error.message,
        consecutiveFailures,
        stack: error.stack?.split('\n')[0]
      });
      
      // 네트워크 관련 오류인 경우 재시도
      const shouldRetry = attempt < maxRetries && (
        error.message.includes('504') || 
        error.message.includes('503') || 
        error.message.includes('502') || 
        error.message.includes('timeout') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('fetch failed') ||
        error.message.includes('network') ||
        error.name === 'AbortError' ||
        error.name === 'TimeoutError'
      );
      
      if (shouldRetry) {
        const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;
        
        console.log(`🔄 ${Math.round(delay)}ms 후 재시도... (연속실패: ${consecutiveFailures})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  
  // 모든 재시도 실패
  console.error(`❌ ${maxRetries}번의 업로드 재시도 모두 실패:`, lastError?.message);
  return { 
    success: false, 
    error: `파일 업로드 실패 (${maxRetries}번 재시도): ${lastError?.message || '알 수 없는 오류'}. Render-Supabase 네트워크 연결을 확인해주세요.`
  };
}

/**
 * Supabase Storage에서 파일 다운로드 (강화된 재시도 로직)
 * @param {string} fileName - 파일명
 * @param {string} bucket - 버킷명 (기본값: 'uploads')
 * @param {number} maxRetries - 최대 재시도 횟수 (기본값: 5)
 * @returns {Promise<{success: boolean, data?: Buffer, error?: string}>}
 */
async function downloadFile(fileName, bucket = 'uploads', maxRetries = 5) {
  let lastError = null;
  let consecutiveFailures = 0;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📥 Supabase Storage 다운로드 시도 ${attempt}/${maxRetries}:`, fileName);
      
      // 연속 실패 시 더 긴 대기 (서킷 브레이커 패턴)
      if (consecutiveFailures >= 2) {
        const circuitDelay = Math.min(5000 + consecutiveFailures * 2000, 15000);
        console.log(`🔄 서킷 브레이커: ${circuitDelay}ms 대기 중...`);
        await new Promise(resolve => setTimeout(resolve, circuitDelay));
      }
      
      // Promise.race를 사용한 타임아웃 제어
      const downloadPromise = supabase.storage
        .from(bucket)
        .download(`files/${fileName}`);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Download timeout after 45 seconds')), 45000);
      });
      
      const { data, error } = await Promise.race([downloadPromise, timeoutPromise]);

      if (error) {
        lastError = error;
        consecutiveFailures++;
        console.error(`❌ Supabase 다운로드 오류 (시도 ${attempt}):`, {
          error: error.message,
          status: error.status || error.statusCode,
          consecutiveFailures
        });
        
        // 504, 503, 502, 타임아웃, 네트워크 오류인 경우 재시도
        const shouldRetry = attempt < maxRetries && (
          error.message.includes('504') || 
          error.message.includes('503') || 
          error.message.includes('502') || 
          error.message.includes('Gateway Timeout') || 
          error.message.includes('Bad Gateway') ||
          error.message.includes('Service Unavailable') ||
          error.message.includes('timeout') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('fetch failed') ||
          (error.status >= 500 && error.status < 600)
        );
        
        if (shouldRetry) {
          // 지수 백오프 + 지터 (최대 20초)
          const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          const jitter = Math.random() * 1000; // 0-1초 랜덤
          const delay = baseDelay + jitter;
          
          console.log(`🔄 ${Math.round(delay)}ms 후 재시도... (연속실패: ${consecutiveFailures})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } else {
          // 재시도하지 않는 오류인 경우
          console.error(`❌ 재시도 불가능한 오류:`, error.message);
          return { success: false, error: error.message };
        }
      }

      // Blob을 Buffer로 변환
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`✅ Supabase 다운로드 성공 (시도 ${attempt}):`, {
        fileSize: buffer.length,
        fileName: fileName
      });
      
      consecutiveFailures = 0; // 성공 시 실패 카운터 리셋
      return { success: true, data: buffer };
      
    } catch (error) {
      lastError = error;
      consecutiveFailures++;
      console.error(`❌ 다운로드 예외 오류 (시도 ${attempt}):`, {
        error: error.message,
        consecutiveFailures,
        stack: error.stack?.split('\n')[0]
      });
      
      // 네트워크 관련 오류인 경우 재시도
      const shouldRetry = attempt < maxRetries && (
        error.message.includes('504') || 
        error.message.includes('503') || 
        error.message.includes('502') || 
        error.message.includes('timeout') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('fetch failed') ||
        error.message.includes('network') ||
        error.name === 'AbortError' ||
        error.name === 'TimeoutError'
      );
      
      if (shouldRetry) {
        const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;
        
        console.log(`🔄 ${Math.round(delay)}ms 후 재시도... (연속실패: ${consecutiveFailures})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  
  // 모든 재시도 실패 - 대체 방법 시도
  console.error(`❌ ${maxRetries}번의 재시도 모두 실패. 공개 URL 방법 시도...`);
  
  try {
    const publicUrl = getPublicUrl(fileName, bucket);
    console.log(`🔄 공개 URL 다운로드 시도:`, publicUrl);
    
    const response = await fetch(publicUrl, {
      timeout: 30000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`✅ 공개 URL 다운로드 성공:`, {
      fileSize: buffer.length,
      fileName: fileName
    });
    
    return { success: true, data: buffer };
    
  } catch (publicUrlError) {
    console.error(`❌ 공개 URL 다운로드도 실패:`, publicUrlError.message);
  }
  
  console.error(`❌ 모든 다운로드 방법 실패:`, lastError?.message);
  return { 
    success: false, 
    error: `파일 다운로드 실패 (${maxRetries}번 재시도): ${lastError?.message || '알 수 없는 오류'}. Render-Supabase 네트워크 연결을 확인해주세요.`
  };
}

/**
 * Supabase Storage에서 파일 삭제
 * @param {string} fileName - 파일명
 * @param {string} bucket - 버킷명 (기본값: 'uploads')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteFile(fileName, bucket = 'uploads') {
  try {
    console.log('🗑️ Supabase Storage 파일 삭제:', fileName);
    
    const { error } = await supabase.storage
      .from(bucket)
      .remove([`files/${fileName}`]);

    if (error) {
      console.error('❌ Supabase 삭제 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ Supabase 파일 삭제 성공');
    return { success: true };
  } catch (error) {
    console.error('❌ 삭제 예외 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 파일의 공개 URL 생성
 * @param {string} fileName - 파일명
 * @param {string} bucket - 버킷명 (기본값: 'uploads')
 * @returns {string} 공개 URL
 */
function getPublicUrl(fileName, bucket = 'uploads') {
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(`files/${fileName}`);
  
  return data.publicUrl;
}

/**
 * 매핑 데이터를 Supabase에 저장
 * @param {string} mappingName - 매핑명
 * @param {Object} mappingData - 매핑 데이터
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function saveMappingData(mappingName, mappingData) {
  try {
    console.log('💾 매핑 데이터 저장:', mappingName);
    
    const jsonData = JSON.stringify(mappingData, null, 2);
    const buffer = Buffer.from(jsonData, 'utf8');
    
    const result = await uploadFile(buffer, `${mappingName}.json`, 'mappings');
    
    if (result.success) {
      console.log('✅ 매핑 데이터 저장 성공');
    }
    
    return result;
  } catch (error) {
    console.error('❌ 매핑 저장 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 매핑 데이터를 Supabase에서 로드
 * @param {string} mappingName - 매핑명
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
async function loadMappingData(mappingName) {
  try {
    console.log('📖 매핑 데이터 로드:', mappingName);
    
    const result = await downloadFile(`${mappingName}.json`, 'mappings');
    
    if (!result.success) {
      return result;
    }
    
    const jsonData = result.data.toString('utf8');
    const mappingData = JSON.parse(jsonData);
    
    console.log('✅ 매핑 데이터 로드 성공');
    return { success: true, data: mappingData };
  } catch (error) {
    console.error('❌ 매핑 로드 오류:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 📧 이메일 템플릿 관련 함수들 (Render 배포 대응)
// =====================================================

/**
 * 이메일 템플릿 저장
 * @param {string} templateName - 템플릿명
 * @param {string} subject - 제목
 * @param {string} body - 내용
 * @param {Array} recipients - 수신자 목록
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function saveEmailTemplate(templateName, subject, body, recipients = []) {
  try {
    console.log('💾 이메일 템플릿 저장:', templateName);
    
    const { data, error } = await supabase
      .from('email_templates')
      .upsert({
        template_name: templateName,
        subject: subject,
        body: body,
        recipients: recipients
      });

    if (error) {
      console.error('❌ 이메일 템플릿 저장 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 템플릿 저장 성공');
    return { success: true, data };
  } catch (error) {
    console.error('❌ 이메일 템플릿 저장 예외:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 이메일 템플릿 조회 (단일)
 * @param {string} templateName - 템플릿명
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
async function loadEmailTemplate(templateName) {
  try {
    console.log('📖 이메일 템플릿 조회:', templateName);
    
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('template_name', templateName)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('⚠️ 템플릿을 찾을 수 없음:', templateName);
        return { success: false, error: '템플릿을 찾을 수 없습니다.' };
      }
      console.error('❌ 이메일 템플릿 조회 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 템플릿 조회 성공');
    return { success: true, data };
  } catch (error) {
    console.error('❌ 이메일 템플릿 조회 예외:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 이메일 템플릿 목록 조회
 * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
 */
async function loadEmailTemplates() {
  try {
    console.log('📋 이메일 템플릿 목록 조회');
    
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ 이메일 템플릿 목록 조회 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 템플릿 목록 조회 성공:', data.length + '개');
    return { success: true, data };
  } catch (error) {
    console.error('❌ 이메일 템플릿 목록 조회 예외:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 이메일 템플릿 삭제
 * @param {string} templateName - 템플릿명
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteEmailTemplate(templateName) {
  try {
    console.log('🗑️ 이메일 템플릿 삭제:', templateName);
    
    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('template_name', templateName);

    if (error) {
      console.error('❌ 이메일 템플릿 삭제 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 템플릿 삭제 성공');
    return { success: true };
  } catch (error) {
    console.error('❌ 이메일 템플릿 삭제 예외:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 📧 이메일 전송 이력 관련 함수들 (Render 배포 대응)
// =====================================================

/**
 * 이메일 전송 이력 저장
 * @param {Object} historyData - 이력 데이터
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function saveEmailHistory(historyData) {
  try {
    console.log('📝 이메일 전송 이력 저장:', historyData.to_email);
    
    const { data, error } = await supabase
      .from('email_history')
      .insert({
        to_email: historyData.to,
        subject: historyData.subject,
        attachment_name: historyData.attachmentName,
        sent_at: historyData.sentAt,
        message_id: historyData.messageId,
        status: historyData.status,
        error_message: historyData.error,
        template_name: historyData.templateName
      });

    if (error) {
      console.error('❌ 이메일 이력 저장 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 이력 저장 성공');
    return { success: true, data };
  } catch (error) {
    console.error('❌ 이메일 이력 저장 예외:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 이메일 전송 이력 조회
 * @param {number} limit - 조회할 개수 (기본값: 100)
 * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
 */
async function loadEmailHistory(limit = 100) {
  try {
    console.log('📋 이메일 전송 이력 조회 (최대 ' + limit + '개)');
    
    const { data, error } = await supabase
      .from('email_history')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ 이메일 이력 조회 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 이력 조회 성공:', data.length + '개');
    return { success: true, data };
  } catch (error) {
    console.error('❌ 이메일 이력 조회 예외:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 이메일 전송 이력 삭제 (단일)
 * @param {string} historyId - 이력 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteEmailHistory(historyId) {
  try {
    console.log('🗑️ 이메일 이력 삭제:', historyId);
    
    const { error } = await supabase
      .from('email_history')
      .delete()
      .eq('id', historyId);

    if (error) {
      console.error('❌ 이메일 이력 삭제 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 이메일 이력 삭제 성공');
    return { success: true };
  } catch (error) {
    console.error('❌ 이메일 이력 삭제 예외:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 전체 이메일 전송 이력 삭제
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function clearEmailHistory() {
  try {
    console.log('🗑️ 전체 이메일 이력 삭제');
    
    const { data, error } = await supabase
      .from('email_history')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 모든 레코드 삭제

    if (error) {
      console.error('❌ 전체 이메일 이력 삭제 오류:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ 전체 이메일 이력 삭제 성공');
    return { success: true, data };
  } catch (error) {
    console.error('❌ 전체 이메일 이력 삭제 예외:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  uploadFile,
  downloadFile,
  deleteFile,
  getPublicUrl,
  saveMappingData,
  loadMappingData,
  // 이메일 템플릿 함수들
  saveEmailTemplate,
  loadEmailTemplate,
  loadEmailTemplates,
  deleteEmailTemplate,
  // 이메일 이력 함수들
  saveEmailHistory,
  loadEmailHistory,
  deleteEmailHistory,
  clearEmailHistory,
  supabase
}; 