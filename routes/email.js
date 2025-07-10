const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { 
  downloadFile, 
  saveEmailTemplate, 
  loadEmailTemplate, 
  loadEmailTemplates,
  deleteEmailTemplate,
  saveEmailHistory,
  loadEmailHistory,
  clearEmailHistory
} = require('../utils/supabase');

const router = express.Router();

// 📧 이메일 전송 설정
const createTransporter = () => {
  // 환경 변수가 없으면 테스트 모드로 실행
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('⚠️  이메일 설정이 없어 테스트 모드로 실행됩니다.');
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: 'test@test.com',
        pass: 'test123'
      }
    });
  }
  
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

// 📧 이메일 전송
router.post('/send', async (req, res) => {
  try {
    const { 
      to, 
      subject, 
      body, 
      attachmentPath, 
      attachmentDisplayName, // 사용자 친화적 파일명 추가
      templateId,
      scheduleTime 
    } = req.body;

    // 필수 필드 검증
    if (!to || !subject || !attachmentPath) {
      return res.status(400).json({ 
        error: '필수 필드가 누락되었습니다. (받는 사람, 제목, 첨부파일)' 
      });
    }

    // Supabase Storage에서 첨부파일 다운로드 (메모리 버퍼로 처리)
    console.log('📥 이메일 첨부파일 다운로드 중:', attachmentPath);
    const downloadResult = await downloadFile(attachmentPath, 'generated');
    
    if (!downloadResult.success) {
      console.log('❌ 첨부파일 다운로드 실패:', downloadResult.error);
      
      // 네트워크 오류인 경우 더 구체적인 안내
      const isNetworkError = downloadResult.error.includes('504') || 
                            downloadResult.error.includes('timeout') ||
                            downloadResult.error.includes('Gateway') ||
                            downloadResult.error.includes('네트워크');
      
      const errorMessage = isNetworkError 
        ? '첨부파일 다운로드 중 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
        : '첨부파일을 찾을 수 없습니다. 발주서가 정상적으로 생성되었는지 확인해주세요.';
      
      return res.status(isNetworkError ? 503 : 404).json({ 
        error: errorMessage,
        details: downloadResult.error,
        suggestion: isNetworkError 
          ? '네트워크 상태가 안정된 후 다시 시도해주세요.'
          : '발주서를 다시 생성한 후 이메일 전송을 시도해주세요.'
      });
    }
    
    console.log('✅ 첨부파일 메모리 로드 완료 (Render 배포 최적화):', {
      fileSize: downloadResult.data.length,
      fileName: attachmentPath
    });

    // 이메일 템플릿 적용 (템플릿이 있는 경우)
    let emailBody = body || '안녕하세요.\n\n발주서를 첨부파일로 보내드립니다.\n\n확인 후 회신 부탁드립니다.\n\n감사합니다.';
    let emailSubject = subject;

    if (templateId) {
      const templateResult = await loadEmailTemplate(templateId);
      if (templateResult.success && templateResult.data) {
        emailSubject = templateResult.data.subject || subject;
        emailBody = templateResult.data.body || body;
        console.log('✅ 이메일 템플릿 적용:', templateId);
      } else {
        console.log('⚠️ 템플릿 로드 실패, 기본값 사용:', templateId);
      }
    }

    // 즉시 전송인지 예약 전송인지 확인
    if (scheduleTime && new Date(scheduleTime) > new Date()) {
      console.log(`📅 이메일 예약됨: ${scheduleTime}에 ${to}로 전송 예정`);
      
      // 실제 예약 전송 구현
      const delayMs = new Date(scheduleTime).getTime() - new Date().getTime();
      
      if (delayMs > 0) {
        // 예약된 시간에 실제 전송
        setTimeout(async () => {
          try {
            console.log(`📧 예약된 이메일 전송 시작: ${to}`);
            
            const transporter = createTransporter();
            const mailOptions = {
              from: process.env.EMAIL_USER || 'test@test.com',
              to: to,
              subject: emailSubject,
              text: emailBody,
              html: emailBody.replace(/\n/g, '<br>'),
              attachments: [
                {
                  filename: attachmentDisplayName || path.basename(attachmentPath),
                  content: downloadResult.data,
                  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
              ]
            };

            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
              // 시뮬레이션 모드
              console.log('📧 [시뮬레이션] 예약된 이메일 전송:', { to, subject: emailSubject });
              await saveEmailHistory({
                to,
                subject: emailSubject,
                attachmentName: path.basename(attachmentPath),
                sentAt: new Date().toISOString(),
                messageId: 'scheduled-simulation-' + Date.now(),
                status: 'simulation',
                templateName: templateId
              });
            } else {
              // 실제 전송
              const info = await transporter.sendMail(mailOptions);
              console.log('✅ 예약된 이메일 전송 완료:', info.messageId);
              
              await saveEmailHistory({
                to,
                subject: emailSubject,
                attachmentName: attachmentDisplayName || path.basename(attachmentPath),
                sentAt: new Date().toISOString(),
                messageId: info.messageId,
                status: 'success',
                templateName: templateId
              });
            }
          } catch (error) {
            console.error('❌ 예약된 이메일 전송 실패:', error);
            await saveEmailHistory({
              to,
              subject: emailSubject,
              attachmentName: attachmentDisplayName || path.basename(attachmentPath),
              sentAt: new Date().toISOString(),
              status: 'failed',
              error: error.message,
              templateName: templateId
            });
          }
        }, delayMs);
      }
      
      res.json({
        success: true,
        message: `이메일이 ${new Date(scheduleTime).toLocaleString()}에 전송되도록 예약되었습니다.`,
        scheduled: true,
        scheduleTime: scheduleTime,
        delayMinutes: Math.round(delayMs / (1000 * 60))
      });
      
      return;
    }

    // 즉시 전송
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'test@test.com',
      to: to,
      subject: emailSubject,
      text: emailBody,
      html: emailBody.replace(/\n/g, '<br>'),
      attachments: [
        {
          filename: attachmentDisplayName || path.basename(attachmentPath),
          content: downloadResult.data, // 메모리 버퍼 직접 사용 (Render 배포 최적화)
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }
      ]
    };

    // 이메일 설정이 없으면 시뮬레이션 모드
    console.log('🔍 환경변수 체크:', {
      EMAIL_USER: process.env.EMAIL_USER ? '설정됨' : '설정안됨',
      EMAIL_PASS: process.env.EMAIL_PASS ? '설정됨' : '설정안됨',
      NODE_ENV: process.env.NODE_ENV
    });
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('📧 [시뮬레이션 모드] 이메일 전송:', {
        to: to,
        subject: emailSubject,
        attachment: path.basename(attachmentPath)
      });
      
      // 가짜 응답 생성
      const info = {
        messageId: 'simulation-' + Date.now(),
        accepted: [to]
      };
      
      // 전송 이력 저장 (Supabase)
      await saveEmailHistory({
        to,
        subject: emailSubject,
        attachmentName: attachmentDisplayName || path.basename(attachmentPath),
        sentAt: new Date().toISOString(),
        messageId: info.messageId,
        status: 'simulation',
        templateName: templateId
      });

      res.json({
        success: true,
        message: `이메일이 시뮬레이션으로 전송되었습니다. (${to}) - 실제 전송하려면 Gmail 설정을 완료하세요.`,
        messageId: info.messageId,
        sentAt: new Date().toISOString(),
        simulation: true
      });
      
      return;
    }

    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ 이메일 전송 완료 (메모리 버퍼 사용, 임시 파일 없음)');
    
    // 전송 이력 저장 (Supabase)
    await saveEmailHistory({
      to,
      subject: emailSubject,
      attachmentName: attachmentDisplayName || path.basename(attachmentPath),
      sentAt: new Date().toISOString(),
      messageId: info.messageId,
      status: 'success',
      templateName: templateId
    });

    res.json({
      success: true,
      message: `이메일이 성공적으로 전송되었습니다. (${to})`,
      messageId: info.messageId,
      sentAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('이메일 전송 오류:', error);
    
    // 실패 이력 저장 (Supabase)
    await saveEmailHistory({
      to: req.body.to,
      subject: req.body.subject,
      attachmentName: req.body.attachmentDisplayName || (req.body.attachmentPath ? path.basename(req.body.attachmentPath) : ''),
      sentAt: new Date().toISOString(),
      status: 'failed',
      error: error.message,
      templateName: req.body.templateId
    });

    res.status(500).json({ 
      error: '이메일 전송 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📧 이메일 템플릿 저장 (Supabase)
router.post('/template', async (req, res) => {
  try {
    const { templateName, subject, body, recipients } = req.body;
    
    console.log('📧 이메일 템플릿 저장 요청:', templateName);

    const saveResult = await saveEmailTemplate(templateName, subject, body, recipients || []);

    if (!saveResult.success) {
      return res.status(500).json({ 
        error: 'Supabase 템플릿 저장 실패', 
        details: saveResult.error 
      });
    }

    res.json({
      success: true,
      message: '이메일 템플릿이 저장되었습니다.',
      templateId: templateName
    });

  } catch (error) {
    console.error('❌ 템플릿 저장 오류:', error);
    res.status(500).json({ 
      error: '템플릿 저장 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📧 전송 이력 조회 (Supabase)
router.get('/history', async (req, res) => {
  try {
    console.log('📋 이메일 전송 이력 조회 요청');
    
    const historyResult = await loadEmailHistory(100); // 최대 100개 조회

    if (!historyResult.success) {
      return res.status(500).json({ 
        error: 'Supabase 이력 조회 실패', 
        details: historyResult.error 
      });
    }

    res.json({
      success: true,
      history: historyResult.data || []
    });

  } catch (error) {
    console.error('❌ 이력 조회 오류:', error);
    res.status(500).json({ 
      error: '이력 조회 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📧 선택된 이력 삭제
router.delete('/history/delete', (req, res) => {
  try {
    const { indices } = req.body;
    
    if (!Array.isArray(indices) || indices.length === 0) {
      return res.status(400).json({ 
        error: '삭제할 항목의 인덱스가 필요합니다.' 
      });
    }

    const historyPath = path.join(__dirname, '../file/email-history.json');
    
    if (!fs.existsSync(historyPath)) {
      return res.status(404).json({ 
        error: '이력 파일을 찾을 수 없습니다.' 
      });
    }

    let history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    
    // 내림차순 정렬된 상태에서의 인덱스이므로 정렬 먼저
    history = history.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    
    // 인덱스를 내림차순으로 정렬하여 뒤쪽부터 삭제 (인덱스 오류 방지)
    const sortedIndices = indices.sort((a, b) => b - a);
    
    // 유효한 인덱스인지 확인
    for (const index of sortedIndices) {
      if (index < 0 || index >= history.length) {
        return res.status(400).json({ 
          error: `유효하지 않은 인덱스입니다: ${index}` 
        });
      }
    }
    
    // 선택된 항목들 삭제
    for (const index of sortedIndices) {
      history.splice(index, 1);
    }
    
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    
    res.json({
      success: true,
      message: `${indices.length}개 항목이 삭제되었습니다.`,
      deletedCount: indices.length
    });

  } catch (error) {
    console.error('이력 삭제 오류:', error);
    res.status(500).json({ 
      error: '이력 삭제 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📧 전체 이력 삭제 (Supabase)
router.delete('/history/clear', async (req, res) => {
  try {
    console.log('🗑️ 전체 이메일 이력 삭제 요청');
    
    const clearResult = await clearEmailHistory();
    
    if (!clearResult.success) {
      return res.status(500).json({ 
        error: 'Supabase 이력 삭제 실패', 
        details: clearResult.error 
      });
    }
    
    res.json({
      success: true,
      message: '모든 전송 이력이 삭제되었습니다.'
    });

  } catch (error) {
    console.error('❌ 전체 이력 삭제 오류:', error);
    res.status(500).json({ 
      error: '전체 이력 삭제 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// =====================================================
// 📝 기존 유틸리티 함수들은 Supabase 함수로 대체됨
// - loadEmailTemplate → utils/supabase.js의 loadEmailTemplate
// - saveEmailHistory → utils/supabase.js의 saveEmailHistory
// =====================================================

module.exports = router; 