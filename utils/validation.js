const yup = require('yup');

// 📋 주문서 데이터 검증 스키마 (완화된 검증)
const orderSchema = yup.object().shape({
  상품명: yup.string().nullable().transform(value => value || null),
  수량: yup.number().nullable().transform(value => value || null).positive('수량은 0보다 커야 합니다').integer('수량은 정수여야 합니다'),
  단가: yup.number().nullable().transform(value => value || null).positive('단가는 0보다 커야 합니다'),
  고객명: yup.string().nullable().transform(value => value || null),
  연락처: yup.string().nullable().transform(value => value || null).test('phone-format', '올바른 전화번호 형식이 아닙니다', value => {
    if (!value) return true; // 빈 값은 허용
    return /^010-\d{4}-\d{4}$|^\d{2,3}-\d{3,4}-\d{4}$/.test(value);
  }),
  주소: yup.string().nullable().transform(value => value || null)
});

// 🔍 데이터 검증 함수
function validateOrderData(data, headers) {
  const errors = [];
  const warnings = [];
  const validRows = [];
  
  // 발주서 템플릿 감지 (빈 데이터가 대부분인 경우)
  const nonEmptyRows = data.filter(row => 
    Object.values(row).some(value => 
      value !== null && value !== undefined && value.toString().trim() !== ''
    )
  ).length;
  
  if (nonEmptyRows === 0 && data.length > 0) {
    warnings.push({
      type: 'empty_template',
      message: '업로드된 파일이 빈 템플릿으로 보입니다. 실제 주문 데이터가 포함된 파일을 업로드해주세요.',
      severity: 'warning'
    });
  }
  
  // 필수 컬럼 확인 (빈 템플릿이 아닌 경우만)
  if (nonEmptyRows > 0) {
    const requiredColumns = ['상품명', '수량'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    
    if (missingColumns.length > 0) {
      errors.push({
        type: 'missing_columns',
        message: `필수 컬럼이 누락되었습니다: ${missingColumns.join(', ')}`,
        severity: 'error'
      });
    }
  }

  // 각 행 데이터 검증
  data.forEach((row, index) => {
    const rowErrors = [];
    const rowNumber = index + 2; // Excel 행 번호 (헤더 제외)

    // 빈 행 확인 (모든 값이 비어있으면 건너뛰기)
    const hasData = Object.values(row).some(value => 
      value !== null && value !== undefined && value.toString().trim() !== ''
    );
    
    if (!hasData) {
      console.log(`⚠️ 빈 행 건너뛰기: ${rowNumber}행`);
      return; // 빈 행은 검증하지 않음
    }

    try {
      // 기본 스키마 검증
      orderSchema.validateSync(row, { abortEarly: false });
      
      // 추가 비즈니스 로직 검증
      if (row.수량 && parseInt(row.수량) <= 0) {
        rowErrors.push(`수량이 0 이하입니다 (${row.수량})`);
      }
      
      if (row.단가 && parseFloat(row.단가) < 100) {
        warnings.push({
          type: 'low_price',
          message: `${rowNumber}행: 단가가 너무 낮습니다 (${row.단가}원)`,
          row: rowNumber,
          severity: 'warning'
        });
      }

      // 상품명 중복 체크 (상품명이 있는 경우만)
      if (row.상품명) {
        const duplicateIndex = validRows.findIndex(validRow => 
          validRow.상품명 === row.상품명 && validRow.고객명 === row.고객명
        );
        
        if (duplicateIndex !== -1) {
          warnings.push({
            type: 'duplicate',
            message: `${rowNumber}행: 중복된 주문입니다 (${duplicateIndex + 2}행과 동일)`,
            row: rowNumber,
            severity: 'warning'
          });
        }
      }

      if (rowErrors.length === 0) {
        validRows.push(row);
      }

    } catch (validationError) {
      if (validationError.inner) {
        validationError.inner.forEach(err => {
          rowErrors.push(err.message);
        });
      } else {
        rowErrors.push(validationError.message);
      }
    }

    if (rowErrors.length > 0) {
      errors.push({
        type: 'row_error',
        message: `${rowNumber}행: ${rowErrors.join(', ')}`,
        row: rowNumber,
        errors: rowErrors,
        severity: 'error'
      });
    }
  });

  return {
    isValid: errors.length === 0,
    totalRows: data.length,
    validRows: validRows.length,
    errorRows: errors.filter(e => e.severity === 'error').length,
    warningRows: warnings.length,
    errors,
    warnings,
    summary: {
      successRate: data.length > 0 ? Math.round((validRows.length / data.length) * 100) : 0,
      totalIssues: errors.length + warnings.length
    }
  };
}

// 🔧 데이터 정제 함수
function sanitizeOrderData(data) {
  return data.map(row => {
    const cleanRow = {};
    
    Object.keys(row).forEach(key => {
      let value = row[key];
      
      // 공백 제거
      if (typeof value === 'string') {
        value = value.trim();
      }
      
      // 숫자 필드 정리
      if (key === '수량' || key === '단가' || key === '금액') {
        // 콤마 제거 후 숫자 변환
        value = value.toString().replace(/,/g, '');
        if (!isNaN(value) && value !== '') {
          value = parseFloat(value);
        }
      }
      
      // 전화번호 정리
      if (key === '연락처') {
        value = value.toString().replace(/[^\d-]/g, '');
      }
      
      cleanRow[key] = value;
    });
    
    return cleanRow;
  });
}

// 📊 검증 결과 요약 생성
function generateValidationSummary(validation) {
  const summary = {
    status: validation.isValid ? 'success' : 'error',
    message: '',
    details: {
      total: validation.totalRows,
      valid: validation.validRows,
      errors: validation.errorRows,
      warnings: validation.warningRows,
      successRate: validation.summary.successRate
    }
  };

  if (validation.isValid) {
    summary.message = `모든 데이터가 유효합니다! (${validation.validRows}/${validation.totalRows}행 처리 가능)`;
  } else {
    summary.message = `${validation.errorRows}개 행에서 오류가 발견되었습니다. 수정 후 다시 시도해주세요.`;
  }

  return summary;
}

module.exports = {
  validateOrderData,
  sanitizeOrderData,
  generateValidationSummary,
  orderSchema
}; 