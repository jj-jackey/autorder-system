const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// 생성된 파일 저장 디렉토리 설정
const getOutputDir = () => {
  return process.env.NODE_ENV === 'production' 
    ? path.join('/tmp', 'uploads')  // Render에서는 /tmp 사용
    : path.join(__dirname, '../uploads');
};

// 📅 날짜/시간 필드 식별 함수
function isDateTimeField(fieldName) {
  const dateTimeKeywords = [
    '날짜', '시간', '일시', '시각', '접수일', '주문일', '발주일', '배송일',
    'date', 'time', 'datetime', 'timestamp', 'created', 'updated',
    '등록일', '수정일', '완료일', '처리일', '입력일'
  ];
  
  if (!fieldName) return false;
  
  const lowerFieldName = fieldName.toString().toLowerCase();
  return dateTimeKeywords.some(keyword => lowerFieldName.includes(keyword.toLowerCase()));
}

// 📅 날짜/시간 데이터 보존 함수
function preserveDateTimeFormat(value, fieldName) {
  if (!value) return value;
  
  // 날짜/시간 필드가 아니면 그대로 반환
  if (!isDateTimeField(fieldName)) {
    return value;
  }
  
  // 이미 문자열이면 그대로 반환 (원본 형식 유지)
  if (typeof value === 'string') {
    return value;
  }
  
  // Date 객체인 경우 원본 형식에 가깝게 변환
  if (value instanceof Date) {
    // 시간 정보가 있는지 확인 (00:00:00이 아닌 경우)
    const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0;
    
    if (hasTime) {
      // 시간 정보가 있으면 yyyy-MM-dd HH:mm:ss 형식
      return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    } else {
      // 시간 정보가 없으면 yyyy-MM-dd 형식
      return value.toISOString().split('T')[0];
    }
  }
  
  // 숫자인 경우 Excel 시리얼 날짜로 간주하여 변환
  if (typeof value === 'number') {
    try {
      // Excel 시리얼 날짜를 Date 객체로 변환
      const excelDate = new Date((value - 25569) * 86400 * 1000);
      
      // 시간 정보가 있는지 확인
      const hasTime = (value % 1) !== 0;
      
      if (hasTime) {
        return excelDate.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      } else {
        return excelDate.toISOString().split('T')[0];
      }
    } catch (error) {
      console.warn('날짜 변환 오류:', error.message);
      return value;
    }
  }
  
  return value;
}

// 🔄 주문서를 표준 발주서로 변환
async function convertToStandardFormat(sourceFilePath, templateFilePath, mappingRules) {
  try {
    console.log('🔄 데이터 변환 시작');
    console.log('📂 입력 파일:', sourceFilePath);
    console.log('📂 템플릿 파일:', templateFilePath);
    
    const outputDir = getOutputDir();
    
    // 출력 디렉토리 확인 및 생성
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log('📁 출력 디렉토리 생성됨:', outputDir);
    }
    
    // 1. 원본 주문서 데이터 읽기
    const sourceData = await readSourceFile(sourceFilePath);
    
    // 2. 매핑 규칙 적용하여 데이터 변환
    const transformedData = applyMappingRules(sourceData, mappingRules);
    
    // 3. 발주서 템플릿에 데이터 삽입 (targetFields 제거)
    const result = await generatePurchaseOrder(templateFilePath, transformedData);
    
    return result;
    
  } catch (error) {
    console.error('변환 처리 오류:', error);
    throw new Error(`파일 변환 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 📖 원본 파일 읽기 (Excel 또는 CSV)
async function readSourceFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  
  if (extension === '.csv') {
    return await readCSVFile(filePath);
  } else {
    return await readExcelFile(filePath);
  }
}

// 📊 Excel 파일 읽기 (render 환경 최적화 버전)
async function readExcelFile(filePath) {
  console.log('📊 Excel 파일 읽기 시작:', {
    path: filePath,
    timestamp: new Date().toISOString()
  });

  // 파일 존재 확인
  if (!fs.existsSync(filePath)) {
    throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
  }
  
  // 파일 크기 확인
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / 1024 / 1024;
  const fileExtension = path.extname(filePath).toLowerCase();
  
  console.log('📊 파일 정보:', {
    size: stats.size,
    sizeInMB: fileSizeMB.toFixed(2) + 'MB',
    extension: fileExtension
  });
  
  // render 환경에서 파일 크기 제한 (20MB)
  const isProduction = process.env.NODE_ENV === 'production';
  const maxFileSize = isProduction ? 20 : 50;
  
  if (fileSizeMB > maxFileSize) {
    throw new Error(`파일 크기가 너무 큽니다. ${maxFileSize}MB 이하의 파일을 업로드해주세요. (현재: ${fileSizeMB.toFixed(1)}MB)`);
  }
  
  // 구형 XLS 파일 조기 감지 및 빠른 실패
  if (fileExtension === '.xls') {
    console.log('⚠️ 구형 XLS 파일 감지 - 제한적 처리 모드');
    
    // production 환경에서는 더 엄격하게 처리
    if (isProduction) {
      try {
        // 단일 시도만 수행 (타임아웃 10초)
        const result = await Promise.race([
          readExcelFileWithXLSXOptimized(filePath),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('XLS 파일 처리 시간 초과 (10초)')), 10000)
          )
        ]);
        return result;
      } catch (xlsError) {
        console.error('❌ 구형 XLS 파일 처리 실패:', xlsError.message);
        throw new Error(`구형 Excel 파일(.xls)은 지원이 제한적입니다. 다음 방법을 시도해보세요:

1. Excel에서 파일을 열고 "다른 이름으로 저장" → "Excel 통합 문서(.xlsx)" 선택
2. 또는 Google Sheets에서 열고 .xlsx 형식으로 다운로드

문제가 계속되면 CSV 형식으로 저장해보세요.`);
      }
    }
  }
  
  // XLSX 파일 또는 개발 환경에서의 XLS 파일 처리
  try {
    console.log('🔄 Excel 파일 읽기 시도...');
    const result = await Promise.race([
      readExcelFileWithXLSX(filePath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Excel 파일 처리 시간 초과 (30초)')), 30000)
      )
    ]);
    return result;
  } catch (xlsxError) {
    console.warn('⚠️ xlsx 라이브러리 실패:', xlsxError.message);
    
    // production 환경에서는 fallback 제한
    if (isProduction && fileExtension === '.xls') {
      throw new Error(`구형 Excel 파일(.xls) 처리에 실패했습니다. 파일을 .xlsx 형식으로 변환 후 다시 시도해주세요.`);
    }
    
    // ExcelJS fallback (제한적으로)
    try {
      console.log('🔄 ExcelJS로 fallback 시도...');
      const result = await Promise.race([
        readExcelFileWithExcelJS(filePath),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('ExcelJS 처리 시간 초과 (20초)')), 20000)
        )
      ]);
      return result;
    } catch (exceljsError) {
      console.error('❌ ExcelJS도 실패:', exceljsError.message);
      throw new Error(`Excel 파일을 읽을 수 없습니다: ${exceljsError.message}`);
    }
  }
}

// 구형 XLS 파일을 위한 최적화된 읽기 함수 (render 환경용)
async function readExcelFileWithXLSXOptimized(filePath) {
  const XLSX = require('xlsx');
  
  console.log('📋 최적화된 XLS 파일 처리 시작');
  
  try {
    // 메모리 효율적인 Buffer 읽기
    const fileBuffer = fs.readFileSync(filePath);
    
    // 단순한 옵션으로 빠른 시도
    const workbook = XLSX.read(fileBuffer, {
      type: 'buffer',
      cellText: true,
      cellDates: false,
      raw: true,
      codepage: 949, // EUC-KR 우선 시도
      sheetStubs: false, // 빈 셀 무시로 메모리 절약
      bookVBA: false, // VBA 무시
      bookFiles: false, // 파일 메타데이터 무시
      bookProps: false, // 문서 속성 무시
      bookSheets: false, // 시트 메타데이터 무시
      bookDeps: false, // 의존성 무시
      dense: false // 밀집 모드 비활성화
    });
    
    console.log('✅ XLS 파일 읽기 성공 (최적화 모드)');
    
    // 첫 번째 시트만 처리 (빠른 처리)
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('워크시트를 찾을 수 없습니다.');
    }
    
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1, 
      raw: false, 
      defval: '',
      blankrows: false // 빈 행 무시
    });
    
    // 빠른 헤더 찾기 (최대 5행만 확인)
    let headers = [];
    let headerRowIndex = 0;
    
    for (let i = 0; i < Math.min(5, jsonData.length); i++) {
      const row = jsonData[i];
      if (row && row.length > 2) {
        const nonEmptyCount = row.filter(cell => cell && cell.toString().trim() !== '').length;
        if (nonEmptyCount >= 3) {
          headers = row.filter(cell => cell && cell.toString().trim() !== '')
                      .map(cell => cell.toString().trim());
          headerRowIndex = i;
          break;
        }
      }
    }
    
    if (headers.length === 0) {
      throw new Error('헤더를 찾을 수 없습니다.');
    }
    
    // 빠른 데이터 처리 (최대 500행만)
    const data = [];
    const maxRows = Math.min(500, jsonData.length);
    
    for (let i = headerRowIndex + 1; i < maxRows; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      
      const rowData = {};
      headers.forEach((header, index) => {
        const value = row[index] ? row[index].toString().trim() : '';
        rowData[header] = value;
      });
      
      if (Object.values(rowData).some(value => value !== '')) {
        data.push(rowData);
      }
    }
    
    console.log(`✅ 최적화된 XLS 파일 처리 완료: ${data.length}행`);
    return { headers, data };
    
  } catch (error) {
    console.error('❌ 최적화된 XLS 처리 실패:', error.message);
    throw error;
  }
}

// xlsx 라이브러리를 사용한 Excel 파일 읽기
async function readExcelFileWithXLSX(filePath) {
  const XLSX = require('xlsx');
  
  // 파일 확장자 확인
  const fileExtension = path.extname(filePath).toLowerCase();
  
  let workbook;
  
  if (fileExtension === '.xls') {
    // render 환경에서는 제한적 XLS 처리
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      throw new Error('Production 환경에서는 구형 XLS 파일 처리가 제한됩니다. 파일을 XLSX 형식으로 변환해주세요.');
    }
    
    console.log('📋 .xls 파일 처리 (개발 환경)');
    
    try {
      const fileBuffer = fs.readFileSync(filePath);
      
      // 단일 시도만 수행 (EUC-KR 우선)
      workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        cellText: true,
        cellDates: false,
        raw: true,
        codepage: 949, // EUC-KR 인코딩
        sheetStubs: false, // 메모리 절약
        bookVBA: false
      });
      
      console.log('✅ .xls 파일 읽기 성공 (단일 시도)');
      
    } catch (xlsError) {
      console.error('❌ .xls 파일 읽기 실패:', xlsError.message);
      throw new Error(`구형 Excel 파일(.xls) 처리에 실패했습니다. 파일을 Excel에서 .xlsx 형식으로 저장 후 다시 시도해주세요.`);
    }
  } else {
    // .xlsx 파일을 위한 일반적인 처리
    console.log('📋 .xlsx 파일 처리');
    
    workbook = XLSX.readFile(filePath, {
      cellText: false,
      cellDates: true,
      raw: false,
      type: 'file',
      dateNF: 'yyyy-mm-dd hh:mm:ss'
    });
  }
  
  console.log('📊 xlsx - 총 워크시트 개수:', workbook.SheetNames.length);
  
  // 가장 적합한 워크시트 찾기
  let bestSheetName = workbook.SheetNames[0];
  let bestScore = 0;
  
  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const rowCount = range.e.r + 1;
    const colCount = range.e.c + 1;
    
    console.log(`📄 xlsx - 워크시트 ${index + 1}: ${sheetName} (행:${rowCount}, 열:${colCount})`);
    
    if (rowCount < 2 || colCount === 0) return;
    
    let score = 0;
    const lowerSheetName = sheetName.toLowerCase();
    if (lowerSheetName.includes('sheet') || lowerSheetName.includes('데이터') || lowerSheetName.includes('주문')) {
      score += 10;
    }
    if (lowerSheetName.includes('요약') || lowerSheetName.includes('피벗')) {
      score -= 20;
    }
    score += Math.min(rowCount / 10, 20);
    score += Math.min(colCount, 10);
    
    console.log(`📊 xlsx - 워크시트 ${index + 1} 점수: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sheetName;
    }
  });
  
  console.log(`✅ xlsx - 선택된 워크시트: ${bestSheetName}`);
  
  const worksheet = workbook.Sheets[bestSheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
    header: 1, 
    raw: false, 
    defval: '',
    dateNF: 'yyyy-mm-dd hh:mm:ss'  // 날짜/시간 형식 보존
  });
  
  // 헤더 행 찾기
  let headerRowIndex = 0;
  let bestHeaderScore = 0;
  
  for (let i = 0; i < Math.min(10, jsonData.length); i++) {
    const row = jsonData[i];
    if (!row || row.length === 0) continue;
    
    let score = 0;
    const nonEmptyValues = row.filter(cell => cell && cell.toString().trim() !== '');
    
    if (nonEmptyValues.length >= 2) {
      nonEmptyValues.forEach(cell => {
        const cellValue = cell.toString().trim().toLowerCase();
        if (cellValue.includes('상품') || cellValue.includes('제품') || cellValue.includes('품목')) score += 10;
        if (cellValue.includes('수량') || cellValue.includes('qty')) score += 10;
        if (cellValue.includes('가격') || cellValue.includes('단가') || cellValue.includes('price')) score += 10;
        if (cellValue.includes('고객') || cellValue.includes('주문자') || cellValue.includes('이름')) score += 8;
        if (cellValue.includes('연락') || cellValue.includes('전화') || cellValue.includes('휴대폰')) score += 8;
        if (cellValue.includes('주소') || cellValue.includes('배송')) score += 8;
        if (cellValue.length > 0 && cellValue.length <= 10) score += 1;
      });
      
      score += nonEmptyValues.length;
      
      console.log(`📋 xlsx - 행 ${i + 1} 분석: 점수=${score}, 비어있지 않은 값 개수=${nonEmptyValues.length}`);
      
      if (score > bestHeaderScore) {
        bestHeaderScore = score;
        headerRowIndex = i;
      }
    }
  }
  
  if (bestHeaderScore < 10) {
    throw new Error('적절한 헤더 행을 찾을 수 없습니다.');
  }
  
  const headers = jsonData[headerRowIndex]
    .filter(cell => cell && cell.toString().trim() !== '')
    .map(cell => cell.toString().trim());
  
  console.log(`✅ xlsx - 헤더 행: ${headerRowIndex + 1}, 헤더 개수: ${headers.length}`);
  console.log(`📋 xlsx - 발견된 헤더: [${headers.slice(0, 8).join(', ')}...]`);
  
  // 데이터 행 처리
  const data = [];
  for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.length === 0) continue;
    
    const rowData = {};
    headers.forEach((header, index) => {
      let value = row[index] ? row[index].toString().trim() : '';
      
      // 날짜/시간 필드인 경우 원본 형식 보존
      if (isDateTimeField(header)) {
        value = preserveDateTimeFormat(row[index], header);
        console.log(`📅 Excel 읽기 날짜/시간 필드: ${header} = "${value}"`);
      }
      
      rowData[header] = value;
    });
    
    if (Object.values(rowData).some(value => value !== '')) {
      data.push(rowData);
    }
  }
  
  console.log(`✅ xlsx - 데이터 읽기 완료: ${data.length}행`);
  
  return { headers, data };
}

// ExcelJS를 사용한 Excel 파일 읽기 (render 환경 최적화)
async function readExcelFileWithExcelJS(filePath) {
  const workbook = new ExcelJS.Workbook();
  
  // 메타데이터 기본값 설정 (company 오류 방지)
  workbook.creator = 'AutoOrder System';
  workbook.company = 'AutoOrder';
  workbook.created = new Date();
  workbook.modified = new Date();
  
  // render 환경에서 메모리 사용량 제한
  const isProduction = process.env.NODE_ENV === 'production';
  
  // render 환경에 최적화된 옵션으로 파일 읽기
  const readOptions = {
    sharedStrings: 'ignore', // 메타데이터 문제 방지
    hyperlinks: 'ignore',
    worksheets: 'emit',
    styles: 'ignore', // 스타일 정보도 무시
    pictures: 'ignore', // 이미지 무시
    charts: 'ignore' // 차트 무시
  };
  
  // production 환경에서는 더 제한적으로
  if (isProduction) {
    readOptions.merges = 'ignore'; // 병합 셀 무시
    readOptions.conditionalFormattings = 'ignore'; // 조건부 서식 무시
    readOptions.dataValidations = 'ignore'; // 데이터 검증 무시
  }
  
  await workbook.xlsx.readFile(filePath, readOptions);
  
  console.log('📊 ExcelJS - 총 워크시트 개수:', workbook.worksheets.length);
  
  // 1. 가장 적합한 워크시트 찾기
  let bestWorksheet = null;
  let bestScore = 0;
  
  try {
    workbook.worksheets.forEach((worksheet, index) => {
      try {
        console.log(`📄 워크시트 ${index + 1} 분석: ${worksheet.name} (행:${worksheet.rowCount}, 열:${worksheet.columnCount})`);
        
        // 데이터가 없거나 너무 적은 워크시트 제외
        if (worksheet.rowCount < 2 || worksheet.columnCount === 0) {
          console.log(`❌ 워크시트 ${index + 1} 제외: 데이터 부족`);
          return;
        }
        
        // 워크시트 점수 계산
        let score = 0;
        
        // 이름으로 점수 추가
        const sheetName = worksheet.name.toLowerCase();
        if (sheetName.includes('sheet') || sheetName.includes('데이터') || sheetName.includes('주문')) {
          score += 10;
        }
        if (sheetName.includes('요약') || sheetName.includes('피벗')) {
          score -= 20; // 요약/피벗 테이블은 피함
        }
        
        // 데이터 양으로 점수 추가
        score += Math.min(worksheet.rowCount / 10, 20); // 최대 20점
        score += Math.min(worksheet.columnCount, 10); // 최대 10점
        
        console.log(`📊 워크시트 ${index + 1} 점수: ${score}`);
        
        if (score > bestScore) {
          bestScore = score;
          bestWorksheet = worksheet;
        }
      } catch (sheetError) {
        console.warn(`⚠️ 워크시트 ${index + 1} 분석 중 오류 (건너뜀):`, sheetError.message);
      }
    });
  } catch (worksheetError) {
    console.error('❌ 워크시트 분석 중 오류:', worksheetError.message);
    // 첫 번째 워크시트를 기본으로 사용
    bestWorksheet = workbook.getWorksheet(1);
    console.log('🔄 첫 번째 워크시트를 기본으로 사용');
  }
  
  if (!bestWorksheet) {
    throw new Error('적절한 워크시트를 찾을 수 없습니다.');
  }
  
  console.log(`✅ 선택된 워크시트: ${bestWorksheet.name}`);
  
  // 2. 헤더 행 찾기
  let headerRowNum = 1;
  let headers = [];
  let maxHeaderScore = 0;
  
  const maxRowsToCheck = Math.min(10, bestWorksheet.rowCount);
  console.log(`🔍 헤더 검색 범위: 1-${maxRowsToCheck}행`);
  
  for (let rowNumber = 1; rowNumber <= maxRowsToCheck; rowNumber++) {
    try {
      const row = bestWorksheet.getRow(rowNumber);
      const potentialHeaders = [];
      let headerScore = 0;
      
      // 현재 행의 셀들을 확인 (최대 50개 컬럼까지 확장)
      const maxColumnsToCheck = Math.min(50, bestWorksheet.columnCount);
      for (let colNumber = 1; colNumber <= maxColumnsToCheck; colNumber++) {
        try {
          const cell = row.getCell(colNumber);
          const value = cell.value ? cell.value.toString().trim() : '';
          potentialHeaders.push(value);
          
          // 헤더 키워드로 점수 계산
          if (value) {
            if (value.includes('상품') || value.includes('제품') || value.includes('품목')) headerScore += 10;
            if (value.includes('수량') || value.includes('qty')) headerScore += 10;
            if (value.includes('가격') || value.includes('단가') || value.includes('price')) headerScore += 10;
            if (value.includes('고객') || value.includes('주문자') || value.includes('이름') || value.includes('성')) headerScore += 8;
            if (value.includes('연락') || value.includes('전화') || value.includes('휴대폰')) headerScore += 8;
            if (value.includes('주소') || value.includes('배송')) headerScore += 8;
            if (value.includes('이메일') || value.includes('email')) headerScore += 5;
            if (value.length > 0) headerScore += 1; // 빈 값이 아니면 1점
          }
        } catch (cellError) {
          console.warn(`⚠️ 셀 읽기 오류 (${rowNumber}, ${colNumber}): ${cellError.message}`);
          potentialHeaders.push('');
        }
      }
      
      console.log(`행 ${rowNumber} 헤더 점수: ${headerScore}, 샘플: [${potentialHeaders.slice(0, 5).join(', ')}...]`);
      
      if (headerScore > maxHeaderScore && headerScore > 5) { // 최소 점수 조건
        maxHeaderScore = headerScore;
        headerRowNum = rowNumber;
        headers = potentialHeaders.filter(h => h !== ''); // 빈 값 제거
      }
    } catch (rowError) {
      console.warn(`⚠️ 행 ${rowNumber} 처리 중 오류 (건너뜀):`, rowError.message);
    }
  }
  
  if (headers.length === 0) {
    // 헤더를 찾지 못한 경우 기본 컬럼명 생성
    console.log('⚠️ 헤더를 찾지 못함, 기본 컬럼명 사용');
    const firstDataRow = bestWorksheet.getRow(1);
    for (let colNumber = 1; colNumber <= bestWorksheet.columnCount; colNumber++) {
      headers.push(`컬럼${colNumber}`);
    }
    headerRowNum = 0; // 데이터가 1행부터 시작
  }
  
  console.log(`✅ 헤더 행: ${headerRowNum}, 헤더 개수: ${headers.length}`);
  console.log(`📋 발견된 헤더: [${headers.slice(0, 8).join(', ')}...]`);
  
  // AA 컬럼 (27번째) 확인
  if (headers.length >= 27) {
    console.log(`🏠 AA 컬럼 (27번째) 헤더: "${headers[26]}"`);
  } else {
    console.log(`❌ AA 컬럼 (27번째)을 찾을 수 없음 - 총 헤더 개수: ${headers.length}`);
  }
  
  // 3. 데이터 읽기 (render 환경 최적화)
  const data = [];
  const dataStartRow = headerRowNum + 1;
  
  // render 환경에서 처리할 최대 행 수 제한
  const maxRowLimit = isProduction ? 1000 : 5000;
  const maxRowsToProcess = Math.min(bestWorksheet.rowCount, maxRowLimit);
  
  console.log(`📋 데이터 읽기 시작: ${dataStartRow}행부터 ${maxRowsToProcess}행까지 (총 ${bestWorksheet.rowCount}행, 제한: ${maxRowLimit}행)`);
  
  let processedRows = 0;
  let skippedRows = 0;
  
  for (let rowNumber = dataStartRow; rowNumber <= maxRowsToProcess; rowNumber++) {
    try {
      const row = bestWorksheet.getRow(rowNumber);
      const rowData = {};
      
      headers.forEach((header, index) => {
        try {
          const cell = row.getCell(index + 1);
          const value = cell.value ? cell.value.toString().trim() : '';
          rowData[header] = value;
        } catch (cellError) {
          console.warn(`⚠️ 셀 읽기 오류 (${rowNumber}, ${index + 1}): ${cellError.message}`);
          rowData[header] = '';
        }
      });
      
      // 빈 행 제외 (모든 값이 빈 문자열인 경우)
      if (Object.values(rowData).some(value => value !== '')) {
        data.push(rowData);
        processedRows++;
        
        // 첫 5개 데이터 행에서 AA 컬럼 값 확인
        if (processedRows <= 5 && headers.length >= 27) {
          const aaColumnValue = rowData[headers[26]];
          console.log(`🏠 행 ${rowNumber} AA 컬럼 데이터: "${aaColumnValue}"`);
        }
      } else {
        skippedRows++;
      }
      
      // 진행 상황 로그 (500행마다)
      if (rowNumber % 500 === 0) {
        console.log(`📊 진행 상황: ${rowNumber}/${maxRowsToProcess}행 처리됨`);
      }
      
    } catch (rowError) {
      console.warn(`⚠️ 행 ${rowNumber} 처리 중 오류 (건너뜀):`, rowError.message);
      skippedRows++;
    }
  }
  
  console.log(`✅ ExcelJS - 데이터 읽기 완료:`, {
    processedRows: processedRows,
    skippedRows: skippedRows,
    totalDataRows: data.length,
    processingTime: new Date().toISOString()
  });
  
  return { headers, data };
}

// 📄 CSV 파일 읽기
async function readCSVFile(filePath) {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const lines = csvData.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    throw new Error('CSV 파일이 비어있습니다.');
  }
  
  const headers = lines[0].split(',').map(h => h.trim());
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const rowData = {};
    
    headers.forEach((header, index) => {
      rowData[header] = values[index] || '';
    });
    
    if (Object.values(rowData).some(value => value !== '')) {
      data.push(rowData);
    }
  }
  
  return { headers, data };
}

// 🗺️ 매핑 규칙 적용
function applyMappingRules(sourceData, mappingRules) {
  const { headers, data } = sourceData;
  
  console.log('📋 매핑 규칙 적용 시작');
  console.log('📂 원본 데이터 헤더:', headers);
  console.log('📋 매핑 규칙 타입:', typeof mappingRules);
  console.log('📋 매핑 규칙 전체:', JSON.stringify(mappingRules, null, 2));
  
  // 매핑 규칙 구조 확인 및 정리
  let rules = {};
  let fixedValues = {};
  
  if (mappingRules && mappingRules.rules) {
    // 새로운 구조: { rules: {...}, fixedValues: {...} }
    rules = mappingRules.rules;
    fixedValues = mappingRules.fixedValues || {};
    console.log('🔄 새로운 구조 매핑 규칙 사용');
  } else if (mappingRules && mappingRules.mappingRules) {
    // 중간 구조: { mappingRules: {...} }
    rules = mappingRules.mappingRules;
    console.log('🔄 중간 구조 매핑 규칙 사용');
  } else if (mappingRules && typeof mappingRules === 'object' && !Array.isArray(mappingRules)) {
    // 직접 매핑 규칙 객체
    rules = mappingRules;
    console.log('🔄 직접 매핑 규칙 사용');
  } else {
    console.log('⚠️ 매핑 규칙이 null, undefined 또는 잘못된 형태입니다');
    console.log('⚠️ 매핑 규칙 타입:', typeof mappingRules);
    console.log('⚠️ 매핑 규칙 값:', mappingRules);
    console.log('⚠️ 기본 매핑 시스템으로 대체합니다');
    return applyDefaultMapping(data);
  }
  
  console.log('📝 정리된 매핑 규칙:', JSON.stringify(rules, null, 2));
  console.log('🔧 고정값:', JSON.stringify(fixedValues, null, 2));
  
  // 매핑 규칙 검증
  if (!rules || Object.keys(rules).length === 0) {
    console.log('⚠️ 매핑 규칙이 없어 기본 매핑 적용');
    return applyDefaultMapping(data);
  }
  
  console.log('✅ 매핑 규칙 검증 완료:');
  Object.entries(rules).forEach(([target, source]) => {
    console.log(`   ${target} ← ${source}`);
  });
  
  console.log('📊 전체 데이터 변환 시작');
  console.log('📊 원본 데이터 샘플 (첫 3행):', data.slice(0, 3));
  console.log('📊 총 데이터 행 수:', data.length);
  
  const transformedData = data.map((row, index) => {
    const transformedRow = {};
    
    console.log(`\n📊 === 행 ${index + 1} 처리 시작 ===`);
    console.log(`📊 원본 행 데이터:`, JSON.stringify(row, null, 2));
    console.log(`📊 사용 가능한 필드:`, Object.keys(row));
    
    // 매핑 규칙에 따라 데이터 변환
    Object.keys(rules).forEach(targetField => {
      const sourceField = rules[targetField];
      
      console.log(`🔄 매핑 시도: ${targetField} ← ${sourceField}`);
      
      // 자동 입력 패턴 확인 ([자동입력: xxx] 형태)
      if (sourceField && sourceField.startsWith('[자동입력:') && sourceField.endsWith(']')) {
        // 자동 입력값에서 실제 값 추출
        const autoValue = sourceField.substring(7, sourceField.length - 1).trim(); // '[자동입력:' 제거하고 ']' 제거
        transformedRow[targetField] = autoValue;
        console.log(`✅ 자동 입력 적용: ${targetField} = "${autoValue}"`);
      }
      // 고정값 패턴 확인 ([고정값: xxx] 형태)
      else if (sourceField && sourceField.startsWith('[고정값:') && sourceField.endsWith(']')) {
        // 고정값에서 실제 값 추출
        const fixedValue = sourceField.substring(6, sourceField.length - 1).trim(); // '[고정값:' 제거하고 ']' 제거
        transformedRow[targetField] = fixedValue;
        console.log(`✅ 고정값 적용: ${targetField} = "${fixedValue}"`);
      }
      // 일반 필드 매핑
      else if (sourceField && row[sourceField] !== undefined) {
        // 날짜/시간 필드인 경우 원본 형식 보존
        const preservedValue = preserveDateTimeFormat(row[sourceField], targetField);
        transformedRow[targetField] = preservedValue;
        console.log(`✅ 필드 매핑 성공: ${targetField} = "${preservedValue}" (소스: ${sourceField})`);
        
        // 날짜/시간 필드인 경우 추가 로그
        if (isDateTimeField(targetField)) {
          console.log(`📅 날짜/시간 필드 처리: ${targetField} - 원본값: ${row[sourceField]}, 보존값: ${preservedValue}`);
        }
      }
      else {
        console.log(`⚠️ 매핑 실패: ${targetField} ← ${sourceField}`);
        console.log(`   - 소스 필드 값: ${row[sourceField]}`);
        console.log(`   - 소스 필드 존재 여부: ${sourceField in row}`);
        console.log(`   - 사용 가능한 필드: ${Object.keys(row).join(', ')}`);
      }
    });
    
    // 고정값이 별도로 전달된 경우 적용
    if (fixedValues && Object.keys(fixedValues).length > 0) {
      Object.keys(fixedValues).forEach(field => {
        transformedRow[field] = fixedValues[field];
        console.log(`✅ 별도 고정값 적용: ${field} = "${fixedValues[field]}"`);
      });
    }
    
    // 계산 필드 추가 (동적 필드명 지원)
    const quantityField = transformedRow.주문수량 || transformedRow.수량;
    const priceField = transformedRow.단가;
    if (quantityField && priceField) {
      transformedRow.금액 = parseInt(quantityField) * parseFloat(priceField);
      console.log(`💰 금액 계산: ${quantityField} × ${priceField} = ${transformedRow.금액}`);
    }
    
    console.log(`✅ 변환된 행 ${index + 1}:`, JSON.stringify(transformedRow, null, 2));
    console.log(`📊 === 행 ${index + 1} 처리 완료 ===\n`);
    return transformedRow;
  });
  
  console.log('📊 전체 데이터 변환 완료');
  console.log('📊 변환된 데이터 샘플 (첫 3행):', transformedData.slice(0, 3));
  console.log('📊 변환된 데이터 총 행 수:', transformedData.length);
  
  return transformedData;
}

// 🔧 기본 매핑 적용 (매핑 규칙이 없는 경우)
function applyDefaultMapping(data) {
  const defaultMappings = {
    '상품명': ['상품명', '품목명', '제품명', 'product'],
    '수량': ['수량', '주문수량', 'quantity', 'qty'],
    '단가': ['단가', '가격', 'price', 'unit_price'],
    '고객명': ['고객명', '주문자', '배송받는분', 'customer'],
    '연락처': ['연락처', '전화번호', 'phone', 'tel'],
    '주소': ['주소', '배송지', 'address']
  };
  
  return data.map(row => {
    const transformedRow = {};
    
    Object.keys(defaultMappings).forEach(targetField => {
      const possibleFields = defaultMappings[targetField];
      
      for (const field of possibleFields) {
        if (row[field] !== undefined) {
          transformedRow[targetField] = row[field];
          break;
        }
      }
    });
    
    // 계산 필드 추가
    if (transformedRow.수량 && transformedRow.단가) {
      transformedRow.금액 = parseInt(transformedRow.수량) * parseFloat(transformedRow.단가);
    }
    
    return transformedRow;
  });
}

// 📋 발주서 생성 (발주서 템플릿 헤더만 사용)
async function generatePurchaseOrder(templateFilePath, transformedData) {
  const outputDir = getOutputDir();
  const workbook = new ExcelJS.Workbook();
  
  // 메타데이터 기본값 설정 (company 오류 방지)
  workbook.creator = 'AutoOrder System';
  workbook.company = 'AutoOrder';
  workbook.created = new Date();
  workbook.modified = new Date();
  
  let templateFields = [];
  
  console.log('📂 발주서 템플릿 파일:', templateFilePath);
  
  // 발주서 템플릿에서만 헤더 필드 추출
  try {
    if (fs.existsSync(templateFilePath)) {
      console.log('📂 발주서 템플릿 파일 읽기 시작:', templateFilePath);
      
      // XLSX 라이브러리로 헤더 추출 (더 안정적)
      try {
        templateFields = extractHeadersWithXLSX(templateFilePath);
        console.log('✅ 발주서 템플릿 헤더 추출 성공:', templateFields);
      } catch (xlsxError) {
        console.error('❌ XLSX 헤더 추출 실패:', xlsxError.message);
        throw new Error('발주서 템플릿에서 헤더를 추출할 수 없습니다: ' + xlsxError.message);
      }
      
      // ExcelJS 워크북 로드 시도하지 않고 바로 새 워크북 생성
      console.log('📋 새 워크북 생성 (헤더 변경 방지)');
      
      // 기존 워크시트 제거
      if (workbook.worksheets.length > 0) {
        workbook.removeWorksheet(workbook.getWorksheet(1));
      }
      const newWorksheet = workbook.addWorksheet('발주서');
      
      // 제목 추가
      newWorksheet.getCell('A1').value = '발주서';
      newWorksheet.getCell('A1').font = { size: 16, bold: true };
      newWorksheet.mergeCells('A1:' + String.fromCharCode(65 + templateFields.length - 1) + '1');
      newWorksheet.getCell('A1').alignment = { horizontal: 'center' };
      
      // XLSX로 추출한 헤더 그대로 사용
      const headerRow = newWorksheet.getRow(2);
      templateFields.forEach((field, index) => {
        headerRow.getCell(index + 1).value = field;
        headerRow.getCell(index + 1).font = { bold: true };
        headerRow.getCell(index + 1).fill = { 
          type: 'pattern', 
          pattern: 'solid', 
          fgColor: { argb: 'FFE0E0E0' } 
        };
        headerRow.getCell(index + 1).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      console.log('✅ 새 워크북 생성 완료 (XLSX 헤더 완전 보존):', templateFields);
      
    } else {
      throw new Error('발주서 템플릿 파일을 찾을 수 없습니다: ' + templateFilePath);
    }
  } catch (templateError) {
    console.error('❌ 발주서 템플릿 처리 완전 실패:', templateError.message);
    throw new Error('발주서 템플릿 파일을 읽을 수 없습니다: ' + templateError.message);
  }
  
  // 발주서 템플릿 헤더가 없으면 에러
  if (templateFields.length === 0) {
    throw new Error('발주서 템플릿에서 헤더를 찾을 수 없습니다.');
  }
  
  const worksheet = workbook.getWorksheet(1);
  
  // 매핑된 데이터 확인 (참고용)
  const availableDataFields = transformedData.length > 0 ? Object.keys(transformedData[0]) : [];
  console.log('📊 매핑된 데이터 필드 (참고용):', availableDataFields);
  console.log('📋 발주서 템플릿 필드 (최종 사용):', templateFields);
  
  // 데이터 시작 행 찾기
  const dataStartRow = findDataStartRow(worksheet) || 3;
  
  // 데이터 삽입 (발주서 템플릿 헤더 기준만)
  const errors = [];
  const processedRows = [];
  
  transformedData.forEach((row, index) => {
    try {
      const dataRow = worksheet.getRow(dataStartRow + index);
      
      // 발주서 템플릿 필드만 기준으로 데이터 삽입
      const rowData = {};
      templateFields.forEach((templateField, colIndex) => {
        let value = row[templateField] || ''; // 매핑된 데이터에서 해당 필드 찾기, 없으면 빈값
        
        // 객체를 문자열로 변환 (richText 포함)
        if (value && typeof value === 'object') {
          console.log(`🔄 객체 데이터 변환: ${templateField}`, value);
          if (value.richText && Array.isArray(value.richText)) {
            // 리치 텍스트 처리
            value = value.richText.map(item => item.text || '').join('');
            console.log(`🎨 리치텍스트 처리: ${templateField} = "${value}"`);
          } else if (Array.isArray(value)) {
            value = value.join(', ');
          } else if (value.toString) {
            value = value.toString();
          } else {
            value = JSON.stringify(value);
          }
          console.log(`✅ 변환 결과: ${templateField} = "${value}"`);
        }
        
        // 숫자 필드 처리
        if (templateField.includes('수량') || templateField.includes('개수')) {
          value = value ? parseInt(value) : '';
        } else if (templateField.includes('단가') || templateField.includes('가격') || templateField.includes('금액') || templateField.includes('공급가액')) {
          value = value ? parseFloat(value) : '';
        }
        // 날짜/시간 필드 처리
        else if (isDateTimeField(templateField)) {
          // 날짜/시간 필드는 원본 형식 유지
          value = preserveDateTimeFormat(value, templateField);
          console.log(`📅 Excel 출력 날짜/시간 필드: ${templateField} = "${value}"`);
        }
        
        const cell = dataRow.getCell(colIndex + 1);
        cell.value = value;
        rowData[templateField] = value;
        
        // 테두리 추가
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      console.log(`📊 Excel 행 ${index + 1} 데이터 삽입 (발주서 템플릿 기준):`, rowData);
      
      processedRows.push(row);
      
    } catch (error) {
      errors.push({
        row: index + 1,
        error: error.message,
        data: row
      });
    }
  });
  
  // 합계 행 추가 (발주서 템플릿 필드 기준)
  if (processedRows.length > 0) {
    const totalRow = worksheet.getRow(dataStartRow + transformedData.length);
    
    templateFields.forEach((templateField, colIndex) => {
      if (templateField.includes('품목') || templateField.includes('상품') || templateField.includes('제품')) {
        totalRow.getCell(colIndex + 1).value = '합계';
        totalRow.getCell(colIndex + 1).font = { bold: true };
      } else if (templateField.includes('수량') || templateField.includes('개수')) {
        const totalQuantity = processedRows.reduce((sum, row) => {
          const value = row[templateField] || 0;
          return sum + (parseInt(value) || 0);
        }, 0);
        if (totalQuantity > 0) {
          totalRow.getCell(colIndex + 1).value = totalQuantity;
          totalRow.getCell(colIndex + 1).font = { bold: true };
        }
      } else if (templateField.includes('금액') || templateField.includes('공급가액') || templateField.includes('총액')) {
        const totalAmount = processedRows.reduce((sum, row) => {
          const value = row[templateField] || 0;
          return sum + (parseFloat(value) || 0);
        }, 0);
        if (totalAmount > 0) {
          totalRow.getCell(colIndex + 1).value = totalAmount;
          totalRow.getCell(colIndex + 1).font = { bold: true };
        }
      }
    });
    
    console.log('📊 합계 계산 완료');
  }
  
  // 컬럼 너비 자동 조정
  templateFields.forEach((field, index) => {
    const column = worksheet.getColumn(index + 1);
    column.width = Math.max(field.length * 1.5, 10);
  });
  
  // 파일 저장
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `purchase_order_${timestamp}.xlsx`;
  const outputPath = path.join(outputDir, fileName);
  
  try {
    await workbook.xlsx.writeFile(outputPath);
    console.log('✅ 발주서 생성 완료 (템플릿 헤더만 사용):', fileName);
  } catch (writeError) {
    console.error('파일 저장 오류:', writeError.message);
    throw new Error('발주서 파일 저장에 실패했습니다.');
  }
  
  return {
    fileName,
    filePath: outputPath,
    processedRows: processedRows.length,
    totalRows: transformedData.length,
    errors,
    templateFields: templateFields
  };
}

// 📋 템플릿에서 헤더 행 찾기
function findHeaderRow(worksheet) {
  for (let rowNumber = 1; rowNumber <= 10; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    let headerCount = 0;
    
    // 헤더 키워드 검색
    for (let colNumber = 1; colNumber <= 20; colNumber++) {
      const cell = row.getCell(colNumber);
      const value = cell.value ? cell.value.toString().trim() : '';
      
      if (value && (
        value.includes('품목') || value.includes('상품') || value.includes('제품') ||
        value.includes('수량') || value.includes('개수') ||
        value.includes('주문') || value.includes('발주') ||
        value.includes('고객') || value.includes('받는') ||
        value.includes('전화') || value.includes('연락') ||
        value.includes('주소') || value.includes('배송')
      )) {
        headerCount++;
      }
    }
    
    if (headerCount >= 3) { // 최소 3개 헤더 필드 있으면 헤더 행으로 인식
      console.log(`📋 헤더 행 발견: ${rowNumber}행 (${headerCount}개 필드)`);
      return rowNumber;
    }
  }
  
  return 2; // 기본값
}

// 📋 헤더 필드 추출
function extractHeaderFields(worksheet, headerRowNumber) {
  const row = worksheet.getRow(headerRowNumber);
  const fields = [];
  
  for (let colNumber = 1; colNumber <= 30; colNumber++) {
    const cell = row.getCell(colNumber);
    const value = cell.value ? cell.value.toString().trim() : '';
    
    if (value && value !== '') {
      fields.push(value);
    }
  }
  
  return fields;
}

// 🔍 템플릿에서 데이터 시작 행 찾기
function findDataStartRow(worksheet) {
  let dataStartRow = 3; // 기본값
  
  // 'NO' 또는 '번호' 헤더를 찾아서 데이터 시작 행 결정
  for (let rowNumber = 1; rowNumber <= 10; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    for (let colNumber = 1; colNumber <= 10; colNumber++) {
      const cell = row.getCell(colNumber);
      if (cell.value && ['NO', '번호', '순번'].includes(cell.value.toString().toUpperCase())) {
        return rowNumber + 1;
      }
    }
  }
  
  return dataStartRow;
}

// 📄 단순한 워크북 생성 (공유 수식 문제 회피)
async function createSimpleWorkbook(transformedData, outputPath, fileName, targetFields = []) {
  const simpleWorkbook = new ExcelJS.Workbook();
  
  // 메타데이터 기본값 설정 (company 오류 방지)
  simpleWorkbook.creator = 'AutoOrder System';
  simpleWorkbook.company = 'AutoOrder';
  simpleWorkbook.created = new Date();
  simpleWorkbook.modified = new Date();
  
  const simpleWorksheet = simpleWorkbook.addWorksheet('발주서');
  
  // 제목 설정
  simpleWorksheet.getCell('A1').value = '발주서';
  simpleWorksheet.getCell('A1').font = { size: 16, bold: true };
  simpleWorksheet.mergeCells('A1:H1');
  simpleWorksheet.getCell('A1').alignment = { horizontal: 'center' };
  
  // TARGET FIELDS 사용 (전달된 것이 있으면 사용, 없으면 기본값)
  let finalTargetFields = [];
  if (targetFields && targetFields.length > 0) {
    finalTargetFields = targetFields;
  } else {
    // 기본 헤더 설정
    finalTargetFields = ['발주번호', '발주일자', '품목명', '주문수량', '단가', '공급가액', '받는분', '전화번호', '주소'];
  }
  
  // 헤더 설정
  finalTargetFields.forEach((header, index) => {
    const cell = simpleWorksheet.getCell(2, index + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });
  
  // 데이터 입력
  const processedRows = [];
  const errors = [];
  
  transformedData.forEach((row, index) => {
    try {
      const dataRowNum = index + 3;
      
      // 자동 생성 필드 처리
      if (!row.발주번호) {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        row.발주번호 = `ORD${today}-${String(index + 1).padStart(3, '0')}`;
      }
      
      if (!row.발주일자) {
        row.발주일자 = new Date().toLocaleDateString('ko-KR');
      }
      
      // TARGET FIELDS 기준으로 데이터 삽입
      finalTargetFields.forEach((field, colIndex) => {
        let value = row[field] || ''; // 매핑된 데이터가 있으면 값, 없으면 빈값
        
        // 숫자 필드 처리
        if (field.includes('수량') || field.includes('개수')) {
          value = value ? parseInt(value) : '';
        } else if (field.includes('단가') || field.includes('가격') || field.includes('금액') || field.includes('공급가액')) {
          value = value ? parseFloat(value) : '';
        }
        
        simpleWorksheet.getCell(dataRowNum, colIndex + 1).value = value;
        
        // 테두리 추가
        simpleWorksheet.getCell(dataRowNum, colIndex + 1).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      processedRows.push(row);
      
    } catch (error) {
      errors.push({
        row: index + 1,
        error: error.message,
        data: row
      });
    }
  });
  
  // 합계 행 추가
  if (processedRows.length > 0) {
    const totalRowNum = transformedData.length + 3;
    
    finalTargetFields.forEach((field, colIndex) => {
      if (field.includes('품목') || field.includes('상품') || field.includes('제품')) {
        simpleWorksheet.getCell(totalRowNum, colIndex + 1).value = '합계';
        simpleWorksheet.getCell(totalRowNum, colIndex + 1).font = { bold: true };
      } else if (field.includes('수량') || field.includes('개수')) {
        const totalQuantity = processedRows.reduce((sum, row) => sum + (parseInt(row[field]) || 0), 0);
        simpleWorksheet.getCell(totalRowNum, colIndex + 1).value = totalQuantity;
        simpleWorksheet.getCell(totalRowNum, colIndex + 1).font = { bold: true };
      } else if (field.includes('금액') || field.includes('공급가액') || field.includes('총액')) {
        const totalAmount = processedRows.reduce((sum, row) => sum + (parseFloat(row[field]) || 0), 0);
        simpleWorksheet.getCell(totalRowNum, colIndex + 1).value = totalAmount;
        simpleWorksheet.getCell(totalRowNum, colIndex + 1).font = { bold: true };
      }
    });
  }
  
  // 컬럼 너비 자동 조정
  finalTargetFields.forEach((field, index) => {
    const column = simpleWorksheet.getColumn(index + 1);
    column.width = Math.max(field.length * 1.5, 10);
  });
  
  // 파일 저장
  await simpleWorkbook.xlsx.writeFile(outputPath);
  
  return {
    fileName,
    filePath: outputPath,
    processedRows: processedRows.length,
    totalRows: transformedData.length,
    errors,
    targetFields: finalTargetFields
  };
}

// 🔄 직접 입력 데이터를 표준 발주서로 변환
async function convertDirectInputToStandardFormat(templateFilePath, inputData, mappingRules) {
  try {
    console.log('🔄 직접 입력 데이터 변환 시작');
    console.log('📂 템플릿 파일:', templateFilePath);
    console.log('📊 입력 데이터:', inputData);
    
    const outputDir = getOutputDir();
    
    // 출력 디렉토리 확인 및 생성
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log('📁 출력 디렉토리 생성됨:', outputDir);
    }
    
    // 1. 입력 데이터를 배열 형태로 변환
    const transformedData = [inputData];
    
    // 2. 발주서 템플릿에 데이터 삽입 (targetFields 제거)
    const result = await generatePurchaseOrder(templateFilePath, transformedData);
    
    return result;
    
  } catch (error) {
    console.error('직접 입력 변환 처리 오류:', error);
    throw new Error(`직접 입력 변환 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 📋 xlsx 라이브러리로 안전하게 헤더 추출
function extractHeadersWithXLSX(templateFilePath) {
  try {
    console.log('📋 XLSX 라이브러리로 헤더 추출 시도:', templateFilePath);
    
    // 파일 읽기
    const workbook = XLSX.readFile(templateFilePath);
    const sheetNames = workbook.SheetNames;
    
    if (sheetNames.length === 0) {
      throw new Error('워크시트가 없습니다.');
    }
    
    console.log('📋 워크시트 이름들:', sheetNames);
    
    // 첫 번째 시트 선택
    const firstSheet = workbook.Sheets[sheetNames[0]];
    
    // 시트를 JSON으로 변환 (헤더만 추출)
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    console.log('📋 전체 데이터 행 수:', jsonData.length);
    console.log('📋 처음 5행 데이터:');
    
    // 처음 5행 출력
    for (let i = 0; i < Math.min(5, jsonData.length); i++) {
      const row = jsonData[i];
      console.log(`📋 행 ${i + 1}:`, row);
    }
    
    if (jsonData.length === 0) {
      throw new Error('시트에 데이터가 없습니다.');
    }
    
    // 동적으로 헤더 행 찾기 (발주서 관련 키워드 기반)
    let headerRow = null;
    let headerRowIndex = -1;
    let bestScore = 0;
    
    // 발주서 관련 핵심 키워드
    const orderKeywords = [
      '상품명', '품목명', '제품명', '아이템명', '상품', '품목', '제품',
      '수량', '개수', 'qty', '량', '개', 
      '고객명', '주문자', '구매자', '받는분', '받는사람', '고객', '성명', '이름',
      '연락처', '전화번호', '휴대폰', '연락', '전화', '번호',
      '주소', '배송지', '배송주소', '수령지', '위치'
    ];
    
    // 최대 10행까지 확인
    for (let i = 0; i < Math.min(10, jsonData.length); i++) {
      const row = jsonData[i];
      if (row && row.length > 0) {
        let score = 0;
        const nonEmptyValues = row.filter(cell => cell && cell.toString().trim() !== '');
        
        // 빈 값이 아닌 셀이 2개 이상 있어야 함
        if (nonEmptyValues.length >= 2) {
          // 발주서 키워드 매칭 점수 계산
          nonEmptyValues.forEach(cell => {
            const cellValue = cell.toString().trim().toLowerCase();
            orderKeywords.forEach(keyword => {
              if (cellValue.includes(keyword.toLowerCase())) {
                score += 10; // 키워드 매칭 시 10점
              }
            });
            
            // 일반적인 헤더 특성 점수
            if (cellValue.length > 0 && cellValue.length <= 10) {
              score += 1; // 적당한 길이의 텍스트
            }
          });
          
          // 연속된 비어있지 않은 셀이 많을수록 높은 점수
          score += nonEmptyValues.length;
          
          console.log(`📋 행 ${i + 1} 분석: 점수=${score}, 비어있지 않은 값 개수=${nonEmptyValues.length}`);
          console.log(`📋 행 ${i + 1} 값들:`, nonEmptyValues);
          
          if (score > bestScore) {
            bestScore = score;
            headerRow = row;
            headerRowIndex = i;
            console.log(`✅ 새로운 최고 점수 헤더 행: ${i + 1}행 (점수: ${score})`);
          }
        }
      }
    }
    
    if (!headerRow || bestScore < 10) {
      throw new Error('적절한 헤더 행을 찾을 수 없습니다. (최소 점수: 10, 현재: ' + bestScore + ')');
    }
    
    // 헤더 정제 (빈 값 제거 및 문자열 변환)
    const cleanHeaders = headerRow
      .filter(cell => cell && cell.toString().trim() !== '')
      .map(cell => cell.toString().trim());
    
    console.log('✅ XLSX 헤더 추출 성공 (동적 탐지):', cleanHeaders);
    console.log('📋 헤더 행 위치:', headerRowIndex + 1);
    console.log('📋 헤더 개수:', cleanHeaders.length);
    console.log('📋 최종 점수:', bestScore);
    
    return cleanHeaders;
    
  } catch (error) {
    console.error('❌ XLSX 헤더 추출 실패:', error.message);
    throw error;
  }
}

module.exports = {
  convertToStandardFormat,
  convertDirectInputToStandardFormat,
  readExcelFile,
  applyMappingRules,
  generatePurchaseOrder
}; 