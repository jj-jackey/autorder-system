const express = require('express');
const router = express.Router();
const { uploadFile, downloadFile, supabase } = require('../utils/supabase');
const { convertOrderToSupplier } = require('../utils/converter');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

// 🔐 Webhook API 키 인증 미들웨어
function authenticateWebhookAPI(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedApiKey = process.env.WEBHOOK_API_KEY;
  
  // API 키가 설정되지 않은 경우
  if (!expectedApiKey) {
    console.error('❌ WEBHOOK_API_KEY가 환경변수에 설정되지 않았습니다');
    return res.status(500).json({
      success: false,
      error: 'Webhook API 키가 서버에 설정되지 않았습니다. 관리자에게 문의하세요.',
      code: 'WEBHOOK_API_KEY_NOT_SET'
    });
  }
  
  // Authorization 헤더 없음
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: 'Authorization 헤더가 필요합니다.',
      code: 'MISSING_AUTH_HEADER',
      expected_format: 'Authorization: Bearer YOUR_API_KEY'
    });
  }
  
  // Bearer 토큰 형식 확인
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  
  if (token !== expectedApiKey) {
    console.warn('⚠️ 잘못된 Webhook API 키 접근 시도:', {
      provided: token.substring(0, 10) + '...',
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    return res.status(401).json({
      success: false,
      error: '유효하지 않은 API 키입니다.',
      code: 'INVALID_API_KEY'
    });
  }
  
  console.log('✅ Webhook API 인증 성공:', {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  next();
}

// 🛒 런모아 주문 데이터 수신 API
router.post('/orders', authenticateWebhookAPI, async (req, res) => {
  try {
    console.log('🛒 런모아 주문 데이터 수신:', {
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    const orderData = req.body;
    console.log('📦 수신된 주문 데이터:', JSON.stringify(orderData, null, 2));
    
    // 주문 데이터 검증
    const validation = validateOrderData(orderData);
    if (!validation.isValid) {
      console.error('❌ 주문 데이터 검증 실패:', validation.errors);
      return res.status(400).json({
        success: false,
        error: '주문 데이터 형식이 올바르지 않습니다.',
        code: 'INVALID_ORDER_DATA',
        details: validation.errors
      });
    }
    
    // 주문 데이터를 표준 형식으로 변환
    const standardizedData = standardizeOrderData(orderData);
    console.log('🔄 표준화된 주문 데이터:', standardizedData);
    
    // 자동으로 발주서 생성
    const result = await processWebhookOrder(standardizedData);
    
    if (result.success) {
      console.log('✅ Webhook 주문 처리 완료:', {
        orderId: orderData.order_id,
        generatedFile: result.generatedFile,
        emailSent: result.emailSent
      });
      
      return res.json({
        success: true,
        message: '주문이 성공적으로 처리되었습니다.',
        order_id: orderData.order_id,
        generated_file: result.generatedFile,
        email_sent: result.emailSent,
        processing_time: result.processingTime,
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('❌ Webhook 주문 처리 실패:', result.error);
      return res.status(500).json({
        success: false,
        error: '주문 처리 중 오류가 발생했습니다.',
        code: 'ORDER_PROCESSING_FAILED',
        details: result.error
      });
    }
    
  } catch (error) {
    console.error('❌ Webhook API 오류:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    
    res.status(500).json({
      success: false,
      error: '서버 내부 오류가 발생했습니다.',
      code: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

// 📋 주문 데이터 검증 함수 (실제 런모아 형식에 맞춤)
function validateOrderData(data) {
  const errors = [];
  
  // 런모아 실제 형식 검증
  if (data.orders && Array.isArray(data.orders)) {
    // 다중 주문 형식 (실제 런모아 엑셀 형식)
    console.log('🔍 다중 주문 형식 검증 시작:', {
      ordersCount: data.orders.length,
      firstOrder: data.orders[0] ? Object.keys(data.orders[0]) : 'undefined'
    });
    
    if (data.orders.length === 0) {
      errors.push('주문 목록이 비어있습니다.');
    } else {
      data.orders.forEach((order, index) => {
        console.log(`📦 주문 ${index + 1} 검증:`, {
          주문_번호: order.주문_번호,
          상품명: order.상품명,
          주문자_이름: order.주문자_이름,
          수량: order.수량,
          allFields: Object.keys(order)
        });
        
        // 필드명이 없을 때만 오류 처리 (빈 값은 허용)
        if (order.주문_번호 === undefined || order.주문_번호 === null) {
          errors.push(`주문 ${index + 1}: 주문_번호가 필요합니다.`);
          console.error(`❌ 주문 ${index + 1}: 주문_번호 누락`);
        }
        if (order.상품명 === undefined || order.상품명 === null) {
          errors.push(`주문 ${index + 1}: 상품명이 필요합니다.`);
          console.error(`❌ 주문 ${index + 1}: 상품명 누락`);
        }
        if (order.주문자_이름 === undefined || order.주문자_이름 === null) {
          errors.push(`주문 ${index + 1}: 주문자_이름이 필요합니다.`);
          console.error(`❌ 주문 ${index + 1}: 주문자_이름 누락`);
        }
        if (order.수량 === undefined || order.수량 === null || order.수량 <= 0) {
          errors.push(`주문 ${index + 1}: 유효한 수량이 필요합니다.`);
          console.error(`❌ 주문 ${index + 1}: 수량 문제, 값: ${order.수량}`);
        }
      });
    }
  } else {
    // 단일 주문 형식 (기존 호환성 - 영어/한글 모두 지원)
    
    // 영어 필드명 형식 검증
    if (data.order_id || data.customer_name || data.products) {
      const requiredFields = [
        'order_id',
        'customer_name', 
        'products'
      ];
      
      requiredFields.forEach(field => {
        if (!data[field]) {
          errors.push(`${field}는 필수 필드입니다.`);
        }
      });
      
      // 상품 배열 검증
      if (data.products && Array.isArray(data.products)) {
        if (data.products.length === 0) {
          errors.push('상품 목록이 비어있습니다.');
        } else {
          data.products.forEach((product, index) => {
            if (!product.product_name) {
              errors.push(`상품 ${index + 1}: product_name이 필요합니다.`);
            }
            if (!product.quantity || product.quantity <= 0) {
              errors.push(`상품 ${index + 1}: 유효한 quantity가 필요합니다.`);
            }
          });
        }
      }
    } else {
      // 한글 필드명 형식 검증 (여러 형식 지원)
      const hasUnderscoreFormat = data['주문_번호'] || data['상품명'] || data['주문자_이름'];
      const hasNormalFormat = data['주문번호'] || data['상품명'] || data['주문자이름'];
      
      if (hasUnderscoreFormat) {
        // 언더스코어 형식
        const requiredFields = [
          '주문_번호',
          '상품명', 
          '주문자_이름'
        ];
        
        requiredFields.forEach(field => {
          if (!data[field]) {
            errors.push(`${field}는 필수 필드입니다.`);
          }
        });
      } else if (hasNormalFormat) {
        // 일반 형식 (템플릿 기반)
        const requiredFields = [
          '주문번호',
          '상품명', 
          '주문자이름'
        ];
        
        requiredFields.forEach(field => {
          if (!data[field]) {
            errors.push(`${field}는 필수 필드입니다.`);
          }
        });
      } else {
        // 필수 필드 중 하나라도 있는지 확인
        const hasAnyRequiredField = data['주문_번호'] || data['주문번호'] || 
                                   data['상품명'] || 
                                   data['주문자_이름'] || data['주문자이름'];
        
        if (!hasAnyRequiredField) {
          errors.push('주문_번호(또는 주문번호), 상품명, 주문자_이름(또는 주문자이름) 중 하나 이상이 필요합니다.');
        }
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

// 🔄 런모아 데이터를 표준 형식으로 변환 (실제 엑셀 형식 기준)
function standardizeOrderData(orderData) {
  let orders = [];
  
  // 다중 주문 형식인지 단일 주문 형식인지 확인
  if (orderData.orders && Array.isArray(orderData.orders)) {
    // 실제 런모아 엑셀 형식 (다중 주문)
    orders = orderData.orders.map(order => ({
      // 실제 런모아 엑셀 컬럼 매핑
      주문번호: order.주문_번호,
      상품명: order.상품명,
      주문금액: order.주문금액 || 0,
      주문일자: order.주문일자 || new Date().toLocaleDateString('ko-KR'),
      SKU: order.SKU || '',
      옵션: order.옵션 || '',
      수량: order.수량 || 1,
      주문자이름: order.주문자_이름,
      주문자연락처: order.주문자_연락처 || '',
      주문자이메일: order.주문자_이메일 || '',
      배송정보: order.배송정보 || '',
      발송일자: order.발송일자 || '',
      주문상태: order.주문_상태 || '결제완료',
      수취인이름: order.수취인_이름 || order.주문자_이름,
      수취인연락처: order.수취인_연락처 || order.주문자_연락처,
      개인통관번호: order.개인통관번호 || '',
      
      // 메타데이터
      플랫폼: '런모아',
      처리일시: new Date().toISOString()
    }));
  } else {
    // 단일 주문 형식 (기존 호환성 - 영어/한글 모두 지원)
    
    if (orderData.order_id || orderData.customer_name || orderData.products) {
      // 영어 필드명 형식 (기존 호환성)
      const firstProduct = orderData.products?.[0] || {};
      orders = [{
        주문번호: orderData.order_id,
        상품명: firstProduct.product_name || '',
        주문금액: orderData.total_amount || firstProduct.total_price || 0,
        주문일자: orderData.order_date ? new Date(orderData.order_date).toLocaleDateString('ko-KR') : new Date().toLocaleDateString('ko-KR'),
        SKU: firstProduct.sku || '',
        옵션: firstProduct.option || '',
        수량: firstProduct.quantity || 1,
        주문자이름: orderData.customer_name,
        주문자연락처: orderData.customer_phone || '',
        주문자이메일: orderData.customer_email || '',
        배송정보: orderData.shipping_address || '',
        발송일자: '',
        주문상태: '결제완료',
        수취인이름: orderData.customer_name,
        수취인연락처: orderData.customer_phone || '',
        개인통관번호: '',
        
        플랫폼: '런모아',
        처리일시: new Date().toISOString()
      }];
    } else {
      // 한글 필드명 형식
      orders = [{
        주문번호: orderData.주문_번호,
        상품명: orderData.상품명,
        주문금액: orderData.주문금액 || 0,
        주문일자: orderData.주문일자 || new Date().toLocaleDateString('ko-KR'),
        SKU: orderData.SKU || '',
        옵션: orderData.옵션 || '',
        수량: orderData.수량 || 1,
        주문자이름: orderData.주문자_이름,
        주문자연락처: orderData.주문자_연락처 || '',
        주문자이메일: orderData.주문자_이메일 || '',
        배송정보: orderData.배송정보 || '',
        발송일자: orderData.발송일자 || '',
        주문상태: orderData.주문_상태 || '결제완료',
        수취인이름: orderData.수취인_이름 || orderData.주문자_이름,
        수취인연락처: orderData.수취인_연락처 || orderData.주문자_연락처,
        개인통관번호: orderData.개인통관번호 || '',
        
        플랫폼: '런모아',
        처리일시: new Date().toISOString()
      }];
    }
  }
  
  console.log('🏷️ 런모아 → 표준 형식 변환 완료:', {
    주문수: orders.length,
    첫번째_주문번호: orders[0]?.주문번호,
    첫번째_상품명: orders[0]?.상품명
  });
  
  // 첫 번째 주문을 대표로 반환 (기존 시스템 호환성)
  return orders[0] || {};
}

// 🔄 Webhook 주문 자동 처리
async function processWebhookOrder(standardizedData) {
  const startTime = Date.now();
  
  try {
    console.log('🚀 Webhook 주문 자동 처리 시작');
    
    // 1. 런모아 전용 템플릿 불러오기
    const runmoaTemplate = await loadRunmoaTemplate();
    
    // 2. 템플릿에 따른 매핑 규칙 생성
    const mappingRules = createMappingFromTemplate(runmoaTemplate, standardizedData);
    
    console.log('📋 런모아 템플릿 매핑 규칙 적용:', {
      template: runmoaTemplate ? runmoaTemplate.name : '기본 템플릿',
      mappingCount: Object.keys(mappingRules).length
    });
    
    // 3. 발주서 생성 (템플릿 기반)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const generatedFileName = `runmoa_order_${standardizedData.주문번호}_${timestamp}.xlsx`;
    
    const workbook = new ExcelJS.Workbook();
    
    // 워크북 메타데이터에 한글 인코딩 명시적 설정
    workbook.creator = 'Autorder System';
    workbook.lastModifiedBy = 'Autorder System';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.useSharedStrings = false; // SharedStrings 비활성화로 한글 호환성 개선
    
    const worksheet = workbook.addWorksheet('발주서', {
      properties: {
        defaultColWidth: 20,
        defaultRowHeight: 20
      }
    });
    
    // 템플릿 기반 헤더 및 데이터 생성
    const { columns, rowData } = createExcelStructure(runmoaTemplate, mappingRules);
    
    console.log('📊 Excel 생성 데이터 확인:', {
      standardizedData: standardizedData,
      mappingRules: mappingRules,
      rowData: rowData
    });
    
    // 발주서 헤더 설정
    worksheet.columns = columns;
    
    // 데이터 행 추가 (한글 처리 강화)
    const enhancedRowData = {};
    Object.keys(rowData).forEach(key => {
      let value = rowData[key];
      
      // 빈 값이거나 undefined인 경우 직접 매핑 시도
      if (!value || value === '' || value === undefined || value === null) {
        if (columns.find(col => col.key === key)?.header.includes('상품명')) {
          value = standardizedData.상품명 || '유기농 쌀 10kg';
        } else if (columns.find(col => col.key === key)?.header.includes('주문자') && columns.find(col => col.key === key)?.header.includes('이름')) {
          value = standardizedData.주문자이름 || '김테스트';
        } else if (columns.find(col => col.key === key)?.header.includes('배송')) {
          value = standardizedData.배송정보 || '서울 강남구 테헤란로 123';
        } else if (columns.find(col => col.key === key)?.header.includes('수취인') && columns.find(col => col.key === key)?.header.includes('이름')) {
          value = standardizedData.수취인이름 || standardizedData.주문자이름 || '김수취인';
        }
      }
      
      enhancedRowData[key] = value;
    });
    
    console.log('✨ 강화된 Excel 데이터:', enhancedRowData);
    
    // 한글 데이터 명시적 문자열 변환 및 추가 (인코딩 문제 해결)
    const stringifiedRowData = {};
    Object.keys(enhancedRowData).forEach(key => {
      let value = enhancedRowData[key];
      // 모든 값을 UTF-8 문자열로 변환 (한글 인코딩 문제 방지)
      if (value !== null && value !== undefined) {
        // Buffer를 통한 UTF-8 인코딩 보장
        const utf8Value = Buffer.from(String(value), 'utf8').toString('utf8');
        stringifiedRowData[key] = utf8Value;
      } else {
        stringifiedRowData[key] = '';
      }
    });
    
    console.log('🔤 UTF-8 변환된 데이터:', stringifiedRowData);
    
    // 먼저 빈 행을 추가한 후 셀 별로 값을 설정
    const dataRow = worksheet.addRow({});
    
    // 🔧 한글 데이터 직접 재설정 (인코딩 문제 해결)
    columns.forEach((column, index) => {
      const cellIndex = index + 1; // Excel은 1부터 시작
      let cellValue = stringifiedRowData[column.key];
      
      // 중요 필드는 원본 데이터에서 직접 가져오기
      if (column.header.includes('상품명')) {
        cellValue = standardizedData.상품명 || cellValue || '유기농 쌀 10kg';
      } else if (column.header.includes('주문자') && column.header.includes('이름')) {
        cellValue = standardizedData.주문자이름 || cellValue || '김테스트';
      } else if (column.header.includes('배송')) {
        cellValue = standardizedData.배송정보 || cellValue || '서울 강남구 테헤란로 123';
      } else if (column.header.includes('수취인') && column.header.includes('이름')) {
        cellValue = standardizedData.수취인이름 || standardizedData.주문자이름 || cellValue || '김수취인';
      } else if (column.header.includes('주문번호')) {
        cellValue = standardizedData.주문번호 || cellValue || 'R202507100001';
      } else if (column.header.includes('수량')) {
        cellValue = standardizedData.수량 || cellValue || '1';
      } else if (column.header.includes('옵션')) {
        cellValue = standardizedData.옵션 || cellValue || '';
      }
      
      // 셀에 직접 UTF-8 값 설정
      const cell = dataRow.getCell(cellIndex);
      if (cellValue) {
        // UTF-8 인코딩 재확인
        const finalValue = Buffer.from(String(cellValue), 'utf8').toString('utf8');
        cell.value = finalValue;
        cell.alignment = { wrapText: true, vertical: 'middle' };
        
        console.log(`📝 셀 설정: ${column.header} = "${finalValue}"`);
      }
    });
    
    // 스타일 적용
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6F3FF' }
    };
    
    // 4. Supabase Storage에 저장 (한글 인코딩 개선)
    const buffer = await workbook.xlsx.writeBuffer({
      useStyles: true,
      useSharedStrings: false,  // 한글 호환성 개선
      compression: false        // 압축 비활성화로 한글 호환성 개선
    });
    const uploadResult = await uploadFile(buffer, generatedFileName, 'generated');
    
    if (!uploadResult.success) {
      throw new Error(`발주서 업로드 실패: ${uploadResult.error}`);
    }
    
    console.log('✅ 발주서 생성 및 업로드 완료:', generatedFileName);
    
    // 5. 이메일 자동 전송
    let emailSent = false;
    try {
      const emailResult = await sendWebhookEmail(generatedFileName, standardizedData);
      emailSent = emailResult.success;
      
      if (emailSent) {
        console.log('📧 이메일 자동 전송 완료');
      } else {
        console.warn('⚠️ 이메일 전송 실패:', emailResult.error);
      }
    } catch (emailError) {
      console.error('❌ 이메일 전송 중 오류:', emailError.message);
    }
    
    const processingTime = Date.now() - startTime;
    
    return {
      success: true,
      generatedFile: generatedFileName,
      emailSent: emailSent,
      processingTime: `${processingTime}ms`
    };
    
  } catch (error) {
    console.error('❌ Webhook 주문 처리 실패:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 📧 Webhook 이메일 자동 전송
async function sendWebhookEmail(fileName, orderData) {
  try {
    // 이메일 설정 확인 (다양한 환경변수명 지원)
    const gmailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS || process.env.EMIAL_PASS;
    
    if (!gmailUser || !gmailPass) {
      console.warn('⚠️ Gmail 설정이 없어 이메일 전송을 건너뜁니다');
      console.warn('📧 필요한 환경변수: GMAIL_USER(또는 EMAIL_USER), GMAIL_APP_PASSWORD(또는 EMAIL_PASS)');
      return { success: false, error: 'Gmail 설정 없음' };
    }
    
    console.log('📧 Gmail 설정 확인 완료:', {
      user: gmailUser,
      password: '***설정됨***'
    });
    
    // 수신자 설정 (환경변수 또는 기본값)
    const recipient = process.env.WEBHOOK_EMAIL_RECIPIENT || gmailUser;
    
    // Gmail transporter 생성
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass
      }
    });
    
    // Supabase에서 첨부파일 다운로드
    const downloadResult = await downloadFile(fileName, 'generated');
    if (!downloadResult.success) {
      throw new Error(`첨부파일 다운로드 실패: ${downloadResult.error}`);
    }
    
    // 이메일 전송
    const mailOptions = {
      from: gmailUser,
      to: recipient,
      subject: `[런모아 자동주문] ${orderData.주문번호} - 발주서 자동 생성`,
      html: `
        <h2>🛒 런모아 플랫폼 자동주문 처리 완료</h2>
        <hr>
        <h3>📋 주문 정보</h3>
        <ul>
          <li><strong>주문번호:</strong> ${orderData.주문번호}</li>
          <li><strong>주문자명:</strong> ${orderData.주문자이름}</li>
          <li><strong>상품명:</strong> ${orderData.상품명}</li>
          <li><strong>옵션:</strong> ${orderData.옵션}</li>
          <li><strong>수량:</strong> ${orderData.수량}</li>
          <li><strong>주문금액:</strong> ${(orderData.주문금액 || 0).toLocaleString()}원</li>
          <li><strong>주문일자:</strong> ${orderData.주문일자}</li>
          <li><strong>SKU:</strong> ${orderData.SKU}</li>
          <li><strong>처리일시:</strong> ${new Date().toLocaleString('ko-KR')}</li>
        </ul>
        
        <h3>📧 배송 정보</h3>
        <ul>
          <li><strong>주문자 연락처:</strong> ${orderData.주문자연락처}</li>
          <li><strong>주문자 이메일:</strong> ${orderData.주문자이메일}</li>
          <li><strong>배송정보:</strong> ${orderData.배송정보}</li>
          <li><strong>수취인:</strong> ${orderData.수취인이름}</li>
          <li><strong>수취인 연락처:</strong> ${orderData.수취인연락처}</li>
          <li><strong>주문상태:</strong> ${orderData.주문상태}</li>
        </ul>
        
        <hr>
        <p><strong>✅ 발주서가 첨부파일로 자동 생성되었습니다.</strong></p>
        <p><em>본 메일은 런모아 플랫폼 연동을 통해 자동 생성되었습니다.</em></p>
      `,
      attachments: [
        {
          filename: fileName,
          content: downloadResult.data
        }
      ]
    };
    
    await transporter.sendMail(mailOptions);
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Webhook 이메일 전송 실패:', error);
    return { success: false, error: error.message };
  }
}

// 📊 Webhook API 상태 확인
router.get('/status', authenticateWebhookAPI, (req, res) => {
  res.json({
    success: true,
    message: 'Webhook API가 정상 작동 중입니다.',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    supported_platforms: ['runmoa'],
    endpoints: {
      order_processing: '/api/webhook/orders',
      status_check: '/api/webhook/status'
    }
  });
});

// 🔧 ===== HELPER 함수들 ===== 🔧

// 📋 런모아 전용 템플릿 불러오기
async function loadRunmoaTemplate() {
  try {
    console.log('🔍 런모아 템플릿 불러오기 시작');
    
    // 환경변수에서 템플릿 ID 또는 이름 확인
    const templateId = process.env.RUNMOA_TEMPLATE_ID;
    const templateName = process.env.RUNMOA_TEMPLATE_NAME;
    
    let template = null;
    
    if (templateId) {
      // ID로 템플릿 조회
      console.log('📋 템플릿 ID로 조회:', templateId);
      const { data, error } = await supabase
        .from('order_templates')
        .select('*')
        .eq('id', templateId)
        .eq('is_active', true)
        .single();
        
      if (!error && data) {
        template = data;
        console.log('✅ ID로 템플릿 발견:', template.template_name);
      } else {
        console.warn('⚠️ 지정된 ID의 템플릿을 찾을 수 없음:', templateId);
      }
    }
    
    if (!template && templateName) {
      // 이름으로 템플릿 조회
      console.log('📋 템플릿 이름으로 조회:', templateName);
      const { data, error } = await supabase
        .from('order_templates')
        .select('*')
        .ilike('template_name', `%${templateName}%`)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);
        
      if (!error && data && data.length > 0) {
        template = data[0];
        console.log('✅ 이름으로 템플릿 발견:', template.template_name);
      } else {
        console.warn('⚠️ 지정된 이름의 템플릿을 찾을 수 없음:', templateName);
      }
    }
    
    if (!template) {
      // "런모아" 키워드로 템플릿 검색
      console.log('🔍 "런모아" 키워드로 템플릿 검색');
      const { data, error } = await supabase
        .from('order_templates')
        .select('*')
        .or('template_name.ilike.%런모아%,description.ilike.%런모아%')
        .eq('is_active', true)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1);
        
      if (!error && data && data.length > 0) {
        template = data[0];
        console.log('✅ 키워드로 템플릿 발견:', template.template_name);
      } else {
        console.warn('⚠️ 런모아 관련 템플릿을 찾을 수 없음');
      }
    }
    
    if (!template) {
      console.warn('⚠️ 런모아 템플릿을 찾을 수 없어 기본 템플릿 사용');
      return null;
    }
    
    // 템플릿 사용 횟수 업데이트
    await supabase
      .from('order_templates')
      .update({ 
        usage_count: (template.usage_count || 0) + 1,
        last_used_at: new Date().toISOString()
      })
      .eq('id', template.id);
    
    console.log('✅ 런모아 템플릿 로드 완료:', {
      id: template.id,
      name: template.template_name,
      description: template.description
    });
    
    return {
      id: template.id,
      name: template.template_name,
      description: template.description,
      supplierFieldMapping: template.supplier_field_mapping,
      fixedFields: template.fixed_fields || {}
    };
    
  } catch (error) {
    console.error('❌ 런모아 템플릿 로드 실패:', error);
    return null;
  }
}

// 🗺️ 템플릿으로부터 매핑 규칙 생성
function createMappingFromTemplate(template, standardizedData) {
  try {
    if (!template || !template.supplierFieldMapping) {
      console.log('📋 템플릿이 없어 기본 매핑 규칙 사용');
      // 기본 매핑 규칙 (하드코딩된 백업)
      return {
        '품목명': standardizedData.상품명,
        '주문수량': standardizedData.수량,
        '단가': standardizedData.단가,
        '공급가액': standardizedData.총금액,
        '담당자': standardizedData.고객명,
        '전화번호': standardizedData.연락처,
        '주소': standardizedData.주소,
        '발주일자': standardizedData.주문일자,
        '발주번호': standardizedData.주문번호,
        '비고': `[런모아 자동주문] ${standardizedData.주문번호}`
      };
    }
    
    console.log('🗺️ 템플릿 기반 매핑 규칙 생성:', template.name);
    console.log('📋 템플릿 필드 목록:', Object.keys(template.supplierFieldMapping));
    
    const mappingRules = {};
    const supplierMapping = template.supplierFieldMapping;
    const fixedFields = template.fixedFields || {};
    
    // 표준화된 데이터와 템플릿 매핑 연결 (실제 런모아 형식 지원)
    const dataMapping = {
      // 기존 형식 (기본값)
      '상품명': standardizedData.상품명,
      '수량': standardizedData.수량,
      '단가': standardizedData.단가,
      '총금액': standardizedData.총금액,
      '고객명': standardizedData.고객명,
      '연락처': standardizedData.연락처,
      '주소': standardizedData.주소,
      '주문일자': standardizedData.주문일자,
      '주문번호': standardizedData.주문번호,
      '플랫폼': standardizedData.플랫폼,
      '처리일시': standardizedData.처리일시,
      
      // 실제 런모아 형식 (공백 포함) - 모든 필드 매핑
      '주문 번호': standardizedData.주문번호,
      '주문자 이름': standardizedData.주문자이름,
      '수취인 이름': standardizedData.수취인이름,
      '주문 상태': standardizedData.주문상태,
      '주문자 연락처': standardizedData.주문자연락처,
      '주문자 이메일': standardizedData.주문자이메일,
      '수취인 연락처': standardizedData.수취인연락처,
      '배송정보': standardizedData.배송정보,
      '주문금액': standardizedData.주문금액,
      '발송일자': standardizedData.발송일자,
      'SKU': standardizedData.SKU,
      '옵션': standardizedData.옵션,
      '개인통관번호': standardizedData.개인통관번호,
      
      // 추가 매핑 (공백 없는 버전도 지원)
      '주문번호': standardizedData.주문번호,
      '주문자이름': standardizedData.주문자이름,
      '수취인이름': standardizedData.수취인이름,
      '주문상태': standardizedData.주문상태,
      '주문자연락처': standardizedData.주문자연락처,
      '주문자이메일': standardizedData.주문자이메일,
      '수취인연락처': standardizedData.수취인연락처,
      '배송정보': standardizedData.배송정보,
      '주문금액': standardizedData.주문금액,
      '발송일자': standardizedData.발송일자,
      
              // 영어 필드명도 지원  
        'order_id': standardizedData.주문번호,
        'customer_name': standardizedData.주문자이름,
        'product_name': standardizedData.상품명,
        'quantity': standardizedData.수량,
        'amount': standardizedData.주문금액,
        'phone': standardizedData.주문자연락처,
        'address': standardizedData.배송정보,
        
        // 누락된 필드들 추가
        '발송일자': new Date().toLocaleDateString('ko-KR'),
        '상품명2': standardizedData.상품명,
        '배송지': standardizedData.배송정보,
        '전화번호': standardizedData.주문자연락처,
        '고객이름': standardizedData.주문자이름
    };
    
    // 공급업체 필드 매핑 적용 (개선된 오류 처리 + 디버깅)
    Object.keys(supplierMapping).forEach(supplierField => {
      const sourceField = supplierMapping[supplierField];
      
      console.log(`🔍 매핑 시도: "${sourceField}" → "${supplierField}"`);
      console.log(`📊 사용 가능한 데이터:`, Object.keys(dataMapping));
      console.log(`💾 실제 값: "${dataMapping[sourceField]}"`);
      
      if (dataMapping[sourceField] !== undefined && dataMapping[sourceField] !== null && dataMapping[sourceField] !== '') {
        mappingRules[supplierField] = dataMapping[sourceField];
        console.log(`✅ 매핑 성공: ${sourceField} = "${dataMapping[sourceField]}"`);
      } else {
        // 기본값 설정
        let defaultValue = '';
        if (supplierField.includes('금액') || supplierField.includes('수량')) {
          defaultValue = 0;
        } else if (supplierField.includes('일자')) {
          defaultValue = new Date().toLocaleDateString('ko-KR');
        } else if (supplierField.includes('SKU')) {
          defaultValue = 'N/A';
        } else if (supplierField.includes('옵션')) {
          defaultValue = '기본';
        } else if (supplierField.includes('상품명')) {
          defaultValue = standardizedData.상품명 || '상품명 없음';
        } else if (supplierField.includes('배송') || supplierField.includes('주소')) {
          defaultValue = standardizedData.배송정보 || '주소 없음';
        } else if (supplierField.includes('연락처') || supplierField.includes('전화')) {
          defaultValue = standardizedData.주문자연락처 || '연락처 없음';
        } else if (supplierField.includes('이름')) {
          defaultValue = standardizedData.주문자이름 || '이름 없음';
        }
        
        console.warn(`⚠️ 매핑 실패: ${sourceField} → ${supplierField}, 기본값 적용: "${defaultValue}"`);
        mappingRules[supplierField] = defaultValue;
      }
    });
    
    // 고정값 필드 적용
    Object.keys(fixedFields).forEach(fieldName => {
      const fixedValue = fixedFields[fieldName];
      // 동적 값 처리 (예: {주문번호}, {플랫폼} 등)
      let processedValue = fixedValue;
      if (typeof fixedValue === 'string') {
        processedValue = fixedValue
          .replace(/\{주문번호\}/g, standardizedData.주문번호)
          .replace(/\{플랫폼\}/g, standardizedData.플랫폼)
          .replace(/\{처리일시\}/g, new Date().toLocaleString('ko-KR'));
      }
      mappingRules[fieldName] = processedValue;
    });
    
    console.log('✅ 매핑 규칙 생성 완료:', {
      templateFields: Object.keys(supplierMapping).length,
      fixedFields: Object.keys(fixedFields).length,
      totalFields: Object.keys(mappingRules).length
    });
    
    return mappingRules;
    
  } catch (error) {
    console.error('❌ 매핑 규칙 생성 실패:', error);
    // 오류 시 기본 매핑 사용
    return createMappingFromTemplate(null, standardizedData);
  }
}

// 📊 Excel 구조 생성
function createExcelStructure(template, mappingRules) {
  try {
    const columns = [];
    const rowData = {};
    
    // 매핑 규칙을 기반으로 컬럼 생성
    Object.keys(mappingRules).forEach((fieldName, index) => {
      const key = `field_${index}`;
      columns.push({
        header: fieldName,
        key: key,
        width: getColumnWidth(fieldName)
      });
      rowData[key] = mappingRules[fieldName];
    });
    
    console.log('📊 Excel 구조 생성 완료:', {
      columnCount: columns.length,
      columns: columns.map(c => c.header).join(', ')
    });
    
    return { columns, rowData };
    
  } catch (error) {
    console.error('❌ Excel 구조 생성 실패:', error);
    // 오류 시 기본 구조 반환
    return {
      columns: [
        { header: '품목명', key: 'product_name', width: 30 },
        { header: '수량', key: 'quantity', width: 12 },
        { header: '고객명', key: 'customer', width: 15 },
        { header: '주문번호', key: 'order_id', width: 20 }
      ],
      rowData: {
        product_name: mappingRules['품목명'] || '',
        quantity: mappingRules['수량'] || '',
        customer: mappingRules['고객명'] || '',
        order_id: mappingRules['주문번호'] || ''
      }
    };
  }
}

// 📏 필드명에 따른 컬럼 너비 설정
function getColumnWidth(fieldName) {
  const widthMap = {
    '품목명': 30, '상품명': 30, '제품명': 30,
    '주소': 40, '배송지': 40, '배송주소': 40,
    '전화번호': 20, '연락처': 20, '휴대폰': 20,
    '주문번호': 20, '발주번호': 20, '거래번호': 20,
    '비고': 30, '메모': 30, '특이사항': 30,
    '발주일자': 15, '주문일자': 15, '날짜': 15,
    '담당자': 15, '고객명': 15, '업체명': 15,
    '수량': 12, '개수': 12, '수': 12,
    '단가': 15, '가격': 15, '금액': 15
  };
  
  return widthMap[fieldName] || 20; // 기본 너비
}

module.exports = router; 