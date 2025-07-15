const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { validateOrderData } = require('../utils/validation');
const { convertToStandardFormat } = require('../utils/converter');
const { uploadFile, downloadFile, saveMappingData, loadMappingData } = require('../utils/supabase');
const axios = require('axios');

const router = express.Router();

// 한글 파일명 디코딩 함수
function decodeFileName(fileName) {
  try {
    // 이미 올바른 한글이면 그대로 반환
    if (/^[a-zA-Z0-9가-힣\s\-_.\(\)]+$/.test(fileName)) {
      return fileName;
    }
    
    // Buffer를 통한 디코딩 시도
    const buffer = Buffer.from(fileName, 'latin1');
    const decoded = buffer.toString('utf8');
    
    // 디코딩 결과 검증
    if (decoded && decoded !== fileName && !/[�]/.test(decoded)) {
      console.log('✅ 파일명 디코딩 성공:', { original: fileName, decoded: decoded });
      return decoded;
    }
    
    // URI 디코딩 시도
    try {
      const uriDecoded = decodeURIComponent(fileName);
      if (uriDecoded !== fileName) {
        console.log('✅ 파일명 URI 디코딩 성공:', { original: fileName, decoded: uriDecoded });
        return uriDecoded;
      }
    } catch (e) {
      // URI 디코딩 실패 시 무시
    }
    
    console.log('⚠️ 파일명 디코딩 실패, 원본 사용:', fileName);
    return fileName;
  } catch (error) {
    console.error('❌ 파일명 디코딩 오류:', error.message);
    return fileName;
  }
}

// 업로드 디렉토리 설정 (개발환경용)
const uploadsDir = path.join(__dirname, '../uploads');

// 개발환경에서만 폴더 생성
if (process.env.NODE_ENV !== 'production' && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 업로드 폴더 생성됨:', uploadsDir);
}

// 파일 업로드 설정 - Supabase Storage 사용 (모든 환경)
const storage = multer.memoryStorage(); // 모든 환경에서 Supabase 사용

// 기존 환경별 스토리지 설정 (주석 처리)
/*
const storage = process.env.NODE_ENV === 'production' 
  ? multer.memoryStorage()  // 프로덕션: 메모리 스토리지 (Supabase로 업로드)
  : multer.diskStorage({    // 개발환경: 디스크 스토리지
      destination: function (req, file, cb) {
        cb(null, uploadsDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
      }
    });
*/

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB로 증가
    fieldSize: 2 * 1024 * 1024   // 2MB
  },
  fileFilter: (req, file, cb) => {
    const decodedFileName = decodeFileName(file.originalname);
    
    console.log('🔍 파일 필터 검사:', {
      originalname: decodedFileName,
      rawOriginalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    // 이진 형식 XLS 파일만 차단 (ZIP 형식은 허용)
    // 매직 바이트는 실제 파일 업로드 시 확인하고, 여기서는 기본 확장자 검증만 수행
    
    // 허용되는 파일 형식 검사 (Excel, CSV 허용)
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const hasValidExtension = allowedExtensions.some(ext => 
      path.extname(decodedFileName).toLowerCase() === ext
    );
    
    if (hasValidExtension) {
      console.log('✅ 파일 필터 통과:', decodedFileName);
      return cb(null, true);
    } else {
      console.log('❌ 파일 필터 실패:', { 
        fileName: decodedFileName, 
        extension: path.extname(decodedFileName).toLowerCase(),
        mimetype: file.mimetype 
      });
      cb(new Error('파일 형식이 지원되지 않습니다. Excel(.xlsx, .xls) 또는 CSV 파일만 업로드 가능합니다.'));
    }
  }
});

// 📁 파일 업로드 및 미리보기
router.post('/upload', upload.single('orderFile'), async (req, res) => {
  try {
    console.log('📁 파일 업로드 요청 수신');
    console.log('🌍 NODE_ENV:', process.env.NODE_ENV);
    
    if (!req.file) {
      console.log('❌ 파일이 업로드되지 않음');
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    // 한글 파일명 디코딩
    const originalFileName = decodeFileName(req.file.originalname);
    
    console.log('📋 업로드된 파일 정보:', {
      originalName: originalFileName,
      rawOriginalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      encoding: req.file.encoding,
      fileType: req.body.fileType || 'order'
    });

    // 매우 구형 BIFF 포맷 파일 확인 (매직 바이트 검사, Excel 2016+ 호환)
    if (req.file.buffer && req.file.buffer.length >= 8) {
      const bytes = req.file.buffer;
      
      console.log('🔍 서버 Excel 파일 포맷 확인:', originalFileName);
      console.log('📋 첫 16바이트:', Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      
      let isBiffBlocked = false;
      
      // 1. ZIP 형식 확인 (OOXML, BIFF12 등)
      if (bytes.length >= 4) {
        const isZIP = bytes[0] === 0x50 && bytes[1] === 0x4B &&
                     (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
                     (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
        
        if (isZIP) {
          console.log('✅ ZIP 기반 Excel 파일 감지 (OOXML/BIFF12):', originalFileName);
          // ZIP 형식이면 OOXML 또는 BIFF12 (허용)
        } else {
          // 2. 매우 구형인 BIFF 시그니처만 확인 (Excel 2016+ 호환)
          const biffSignature = (bytes[1] << 8) | bytes[0]; // Little-endian
          const biffVersion = (bytes[3] << 8) | bytes[2];
          
          // 매우 구형인 BIFF2-BIFF5만 차단 (BIFF8은 Excel 2016+ 호환)
          if (biffSignature === 0x0009 || biffSignature === 0x0209 || 
              biffSignature === 0x0409 || biffSignature === 0x0805) {
            console.log('❌ 매우 구형 BIFF 시그니처 감지:', originalFileName, 'Signature:', biffSignature.toString(16));
            isBiffBlocked = true;
          } else {
            // OLE2 구조는 Excel 2016에서도 사용하므로 허용
            const isOLE2 = bytes[0] === 0xD0 && bytes[1] === 0xCF && 
                           bytes[2] === 0x11 && bytes[3] === 0xE0 &&
                           bytes[4] === 0xA1 && bytes[5] === 0xB1 &&
                           bytes[6] === 0x1A && bytes[7] === 0xE1;
            
            if (isOLE2) {
              console.log('✅ OLE2 구조 감지 (Excel 2016 호환):', originalFileName);
              // OLE2 구조이지만 현대 Excel 호환 (허용)
            }
          }
        }
      }
      
      // 구형 BIFF 포맷 차단
      if (isBiffBlocked) {
        return res.status(400).json({ 
          error: '매우 구형 BIFF 포맷 Excel 파일은 지원되지 않습니다. Excel에서 .xlsx 형식으로 저장 후 업로드해주세요.',
          fileType: 'binary-xls',
          fileName: originalFileName
        });
      }
    }

    // 파일명 생성
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileType = req.body.fileType || 'order';
    const filePrefix = fileType === 'order' ? 'orderFile' : 'supplierFile';
    const fileName = filePrefix + '-' + uniqueSuffix + path.extname(originalFileName);
    
    // Supabase Storage에 업로드 (모든 환경, uploads bucket 사용)
    console.log('📤 Supabase Storage 업로드 중...', {
      fileName: fileName,
      fileSize: req.file.buffer.length,
      bucket: 'uploads',
      timestamp: new Date().toISOString()
    });
    
    const uploadResult = await uploadFile(req.file.buffer, fileName);
    if (!uploadResult.success) {
      console.error('❌ Supabase Storage 업로드 실패:', uploadResult.error);
      return res.status(500).json({ 
        error: 'Supabase Storage 업로드 실패', 
        details: uploadResult.error 
      });
    }
    
    const filePath = fileName; // Supabase에서는 파일명만 저장
    const fileBuffer = req.file.buffer;
    
    console.log('✅ Supabase 업로드 성공:', {
      fileName: fileName,
      uploadTime: new Date().toISOString()
    });

    // 기존 환경별 파일 처리 (주석 처리)
    /*
    let filePath;
    let fileBuffer;

    if (process.env.NODE_ENV === 'production') {
      // 프로덕션: Supabase Storage에 업로드
      console.log('📤 Supabase Storage 업로드 중...');
      
      const uploadResult = await uploadFile(req.file.buffer, fileName);
      if (!uploadResult.success) {
        return res.status(500).json({ 
          error: 'Supabase Storage 업로드 실패', 
          details: uploadResult.error 
        });
      }
      
      filePath = fileName; // Supabase에서는 파일명만 저장
      fileBuffer = req.file.buffer;
      
      console.log('✅ Supabase 업로드 성공:', fileName);
    } else {
      // 개발환경: 로컬 디스크 저장
      filePath = req.file.path;
      fileBuffer = fs.readFileSync(filePath);
      
      console.log('✅ 로컬 파일 저장 성공:', {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        path: filePath
      });
    }
    */

    const fileExtension = path.extname(originalFileName).toLowerCase();
    
    let previewData = [];
    let headers = [];

    if (fileExtension === '.csv') {
      // CSV 파일 처리 - 한글 인코딩 자동 감지 및 개선된 파싱 로직
      let csvData;
      
      // 인코딩 자동 감지 및 변환
      try {
        // BOM 확인
        const hasBom = fileBuffer.length >= 3 && 
                      fileBuffer[0] === 0xEF && 
                      fileBuffer[1] === 0xBB && 
                      fileBuffer[2] === 0xBF;
        
        if (hasBom) {
          // UTF-8 BOM이 있는 경우
          console.log('📄 UTF-8 BOM 감지됨');
          csvData = fileBuffer.slice(3).toString('utf8');
        } else {
          // 여러 인코딩으로 시도
          const encodings = ['utf8', 'euc-kr', 'cp949'];
          let bestEncoding = 'utf8';
          let bestScore = 0;
          
          for (const encoding of encodings) {
            try {
              const testData = iconv.decode(fileBuffer, encoding);
              
              // 한글 문자가 제대로 디코딩되었는지 확인
              const koreanScore = (testData.match(/[가-힣]/g) || []).length;
              const invalidScore = (testData.match(/[�]/g) || []).length;
              const finalScore = koreanScore - (invalidScore * 10); // 깨진 문자에 패널티
              
              console.log(`📊 ${encoding} 인코딩 점수: ${finalScore} (한글: ${koreanScore}, 깨짐: ${invalidScore})`);
              
              if (finalScore > bestScore) {
                bestScore = finalScore;
                bestEncoding = encoding;
              }
            } catch (error) {
              console.log(`⚠️ ${encoding} 인코딩 실패:`, error.message);
            }
          }
          
          console.log(`✅ 최적 인코딩 선택: ${bestEncoding} (점수: ${bestScore})`);
          csvData = iconv.decode(fileBuffer, bestEncoding);
        }
      } catch (error) {
        console.error('❌ 인코딩 감지 실패, UTF-8로 처리:', error);
        csvData = fileBuffer.toString('utf8');
      }
      
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length > 0) {
        // 개선된 CSV 파싱 함수
        function parseCSVLine(line) {
          const result = [];
          let current = '';
          let inQuotes = false;
          let i = 0;
          
          while (i < line.length) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                // 연속된 따옴표는 하나의 따옴표로 처리
                current += '"';
                i += 2;
                continue;
              } else {
                // 따옴표 시작/끝
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              // 따옴표 밖의 쉼표는 구분자
              result.push(current.trim());
              current = '';
            } else {
              current += char;
            }
            i++;
          }
          
          // 마지막 필드 추가
          result.push(current.trim());
          return result;
        }
        
        // 헤더 파싱 및 빈 필드 제거
        const rawHeaders = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
        
        // 빈 헤더나 의미 없는 헤더 제거
        const validHeaderIndices = [];
        const cleanHeaders = [];
        
        rawHeaders.forEach((header, index) => {
          // 유효한 헤더 조건: 비어있지 않고, 공백이 아니며, 의미 있는 텍스트
          if (header && 
              header.length > 0 && 
              header !== 'undefined' && 
              header !== 'null' && 
              !header.match(/^[\s,]+$/)) {
            validHeaderIndices.push(index);
            cleanHeaders.push(header);
          }
        });
        
        headers = cleanHeaders;
        console.log(`📋 헤더 정리: ${rawHeaders.length} → ${headers.length}개 (유효한 필드만)`);
        
        // 데이터 파싱 (상위 20행, 유효한 컬럼만)
        const rawDataLines = lines.slice(1, 21);
        previewData = [];
        
        rawDataLines.forEach((line, lineIndex) => {
          const values = parseCSVLine(line);
          const rowData = {};
          let hasValidData = false;
          
          // 유효한 헤더 인덱스에 해당하는 데이터만 추출
          validHeaderIndices.forEach((headerIndex, cleanIndex) => {
            const header = headers[cleanIndex];
            const value = values[headerIndex] ? values[headerIndex].replace(/^"|"$/g, '').trim() : '';
            
            rowData[header] = value;
            
            // 빈 값이 아니면 유효한 데이터가 있다고 표시
            if (value && value.length > 0) {
              hasValidData = true;
            }
          });
          
          // 유효한 데이터가 있는 행만 추가
          if (hasValidData) {
            previewData.push(rowData);
          } else {
            console.log(`⚠️ 빈 행 제외 (행 ${lineIndex + 2}): 유효한 데이터 없음`);
          }
        });
        
        console.log('✅ CSV 파싱 완료:', {
          원본헤더: rawHeaders.length,
          정리된헤더: headers.length,
          원본행수: rawDataLines.length,
          유효행수: previewData.length,
          샘플헤더: headers.slice(0, 5),
          샘플데이터: previewData.slice(0, 2)
        });
      }
    } else {
      // Excel 파일 처리 - 개선된 로직 사용
      try {
        console.log('🔄 Excel 파일 처리 시작:', {
          fileSize: fileBuffer.length,
          timestamp: new Date().toISOString()
        });

        // 프로덕션 환경에서는 /tmp 폴더 사용
        const tempDir = process.env.NODE_ENV === 'production' 
          ? '/tmp' 
          : path.join(__dirname, '../uploads');
        
        // 임시 파일로 저장하여 개선된 readExcelFile 함수 사용
        const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.xlsx`;
        const tempFilePath = path.join(tempDir, tempFileName);
        
        console.log('📁 임시 파일 생성:', tempFilePath);
        
        // 폴더가 없으면 생성 (로컬에서만)
        if (process.env.NODE_ENV !== 'production' && !fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
          console.log('📁 임시 폴더 생성됨:', tempDir);
        }
        
        try {
          fs.writeFileSync(tempFilePath, fileBuffer);
          console.log('✅ 임시 파일 쓰기 완료:', tempFilePath);
        } catch (writeError) {
          console.error('❌ 임시 파일 쓰기 실패:', writeError.message);
          throw writeError;
        }
        
        // 개선된 Excel 읽기 함수 사용 (타임아웃 적용)
        const { readExcelFile } = require('../utils/converter');
        console.log('🔄 Excel 파일 읽기 시작...');
        
        // 플랫폼별 타임아웃 적용
        const isProduction = process.env.NODE_ENV === 'production';
        const isVercel = process.env.VERCEL === '1';
        const isRender = process.env.RENDER === 'true';
        
        // Vercel: 20초, Render: 30초, 로컬: 60초
        const timeout = isVercel ? 20000 : isRender ? 30000 : 60000;
        
        const excelData = await Promise.race([
          readExcelFile(tempFilePath),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Excel 파일 처리 시간 초과 (${timeout/1000}초)`)), timeout)
          )
        ]);
        
        headers = excelData.headers;
        previewData = excelData.data.slice(0, 20); // 상위 20행만
        
        console.log('✅ Excel 파일 처리 완료:', {
          worksheets: '자동 선택됨',
          headers: headers.length,
          dataRows: excelData.data.length,
          previewRows: previewData.length,
          processingTime: new Date().toISOString()
        });
        
        // 즉시 임시 파일 삭제 (메모리 절약)
        setImmediate(() => {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
              console.log('🗑️ 임시 파일 삭제 완료:', tempFilePath);
            }
          } catch (deleteError) {
            console.warn('⚠️ 임시 파일 삭제 실패 (무시됨):', deleteError.message);
          }
        });
        
      } catch (excelError) {
        console.error('❌ 개선된 Excel 처리 실패:', {
          error: excelError.message,
          stack: excelError.stack?.split('\n')[0],
          fileName: originalFileName,
          fileSize: fileBuffer.length
        });
        
        // 구형 XLS 파일이나 시간 초과인 경우 빠른 실패
        if (originalFileName.toLowerCase().endsWith('.xls') || 
            excelError.message.includes('시간 초과') ||
            excelError.message.includes('timeout')) {
          
          // 임시 파일 즉시 정리
          setImmediate(() => {
            try {
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log('🗑️ XLS 실패 후 임시 파일 삭제 완료');
              }
            } catch (cleanupError) {
              console.warn('⚠️ 임시 파일 정리 실패:', cleanupError.message);
            }
          });
          
          console.log('⚠️ 구형 XLS 파일 또는 시간 초과 - 즉시 실패');
          throw new Error(`구형 Excel 파일(.xls)은 지원이 제한적입니다. 다음 방법을 시도해보세요:

1. Excel에서 파일을 열고 "다른 이름으로 저장" → "Excel 통합 문서(.xlsx)" 선택
2. 또는 Google Sheets에서 열고 .xlsx 형식으로 다운로드

문제가 계속되면 CSV 형식으로 저장해보세요.`);
        }
        
        // production 환경에서는 fallback 제한
        if (isProduction) {
          // 임시 파일 정리
          setImmediate(() => {
            try {
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log('🗑️ Production 실패 후 임시 파일 삭제 완료');
              }
            } catch (cleanupError) {
              console.warn('⚠️ 임시 파일 정리 실패:', cleanupError.message);
            }
          });
          
          console.log('❌ Production 환경에서 fallback 제한');
          throw new Error('파일 처리에 실패했습니다. 파일이 손상되었거나 지원되지 않는 형식일 수 있습니다.');
        }
        
        // 개발 환경에서만 기본 방식으로 fallback
        try {
          console.log('🔄 기본 Excel 처리 방식으로 fallback...');
          const workbook = new ExcelJS.Workbook();
          
          // 메타데이터 기본값 설정 (company 오류 방지)
          workbook.creator = 'AutoOrder System';
          workbook.company = 'AutoOrder';
          workbook.created = new Date();
          workbook.modified = new Date();
          
          // fallback도 타임아웃 적용 (10초)
          await Promise.race([
            workbook.xlsx.load(fileBuffer),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Fallback 처리 시간 초과 (10초)')), 10000)
            )
          ]);
          const worksheet = workbook.getWorksheet(1);
          
          if (worksheet) {
            const firstRow = worksheet.getRow(1);
            headers = [];
            firstRow.eachCell((cell, colNumber) => {
              let cellValue = cell.value;
              
              // 객체를 문자열로 변환
              if (cellValue && typeof cellValue === 'object') {
                if (cellValue.richText && Array.isArray(cellValue.richText)) {
                  // 리치 텍스트 처리
                  cellValue = cellValue.richText.map(item => item.text || '').join('');
                } else if (Array.isArray(cellValue)) {
                  cellValue = cellValue.join(', ');
                } else if (cellValue.toString && typeof cellValue.toString === 'function') {
                  cellValue = cellValue.toString();
                } else {
                  cellValue = JSON.stringify(cellValue);
                }
              }
              
              headers.push(cellValue ? cellValue.toString() : `컬럼${colNumber}`);
            });

            // 상위 20행까지 미리보기 데이터 생성
            for (let rowNumber = 2; rowNumber <= Math.min(21, worksheet.rowCount); rowNumber++) {
              const row = worksheet.getRow(rowNumber);
              const rowData = {};
              
              headers.forEach((header, index) => {
                const cell = row.getCell(index + 1);
                let cellValue = cell.value;
                
                // 객체를 문자열로 변환 (미리보기에서도 richText 처리)
                if (cellValue && typeof cellValue === 'object') {
                  if (cellValue.richText && Array.isArray(cellValue.richText)) {
                    // 리치 텍스트 처리
                    cellValue = cellValue.richText.map(item => item.text || '').join('');
                  } else if (Array.isArray(cellValue)) {
                    cellValue = cellValue.join(', ');
                  } else if (cellValue.toString && typeof cellValue.toString === 'function') {
                    cellValue = cellValue.toString();
                  } else {
                    cellValue = JSON.stringify(cellValue);
                  }
                }
                
                rowData[header] = cellValue ? cellValue.toString() : '';
              });
              
              previewData.push(rowData);
            }
            
            console.log('✅ 기본 Excel 처리 완료:', {
              headers: headers.length,
              previewRows: previewData.length
            });
          }
        } catch (fallbackError) {
          console.error('❌ 기본 Excel 처리도 실패:', fallbackError.message);
          
          // 임시 파일 정리
          setImmediate(() => {
            try {
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log('🗑️ 실패 후 임시 파일 삭제 완료');
              }
            } catch (cleanupError) {
              console.warn('⚠️ 임시 파일 정리 실패:', cleanupError.message);
            }
          });
          
          // .xls 파일인 경우 특별 안내 메시지
          if (originalFileName.toLowerCase().endsWith('.xls')) {
            throw new Error(`구형 Excel 파일(.xls)은 지원이 제한적입니다. 다음 방법을 시도해보세요:\n\n1. Excel에서 파일을 열고 "다른 이름으로 저장" → "Excel 통합 문서(.xlsx)" 선택\n2. 또는 Google Sheets에서 열고 .xlsx 형식으로 다운로드\n\n문제가 계속되면 CSV 형식으로 저장해보세요.`);
          } else {
            throw new Error(`Excel 파일 처리 실패: ${fallbackError.message}`);
          }
        }
      }
    }

    // 데이터 검증
    const validation = validateOrderData(previewData, headers);

    console.log('✅ 파일 처리 완료:', {
      headers: headers.length,
      previewRows: previewData.length,
      isValid: validation.isValid
    });

    res.json({
      success: true,
      fileName: originalFileName,
      fileId: fileName, // 모든 환경에서 Supabase 파일명 사용
      headers: headers,
      previewData: previewData,
      totalRows: previewData.length,
      validation: validation,
      message: `파일이 성공적으로 업로드되었습니다. ${previewData.length}행의 데이터를 확인했습니다.`
    });

    // 기존 환경별 fileId 설정 (주석 처리)
    // fileId: process.env.NODE_ENV === 'production' ? fileName : req.file.filename,

  } catch (error) {
    console.error('❌ 파일 업로드 오류:', {
      error: error.message,
      stack: error.stack?.split('\n')[0],
      fileName: req.file?.originalname ? decodeFileName(req.file.originalname) : 'unknown',
      fileSize: req.file?.size,
      timestamp: new Date().toISOString()
    });
    
    // 최종 오류 시 임시 파일 정리
    if (req.file) {
      setImmediate(() => {
        try {
          const tempDir = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, '../uploads');
          const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.xlsx`;
          const tempFilePath = path.join(tempDir, tempFileName);
          
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log('🗑️ 최종 오류 후 임시 파일 정리 완료');
          }
        } catch (cleanupError) {
          console.warn('⚠️ 최종 임시 파일 정리 실패:', cleanupError.message);
        }
      });
    }
    
    res.status(500).json({ 
      error: '파일 처리 중 오류가 발생했습니다.', 
      details: error.message,
      fileName: req.file?.originalname ? decodeFileName(req.file.originalname) : 'unknown'
    });
  }
});

// 🔄 필드 매핑 설정 저장
router.post('/mapping', async (req, res) => {
  try {
    const { mappingName, sourceFields, targetFields, mappingRules, fixedValues } = req.body;
    
    console.log('📋 매핑 저장 요청 수신');
    console.log('📝 매핑 이름:', mappingName);
    console.log('📂 소스 필드:', sourceFields);
    console.log('🎯 타겟 필드:', targetFields);
    console.log('🔗 매핑 규칙:', mappingRules);
    console.log('🔗 매핑 규칙 타입:', typeof mappingRules);
    console.log('🔗 매핑 규칙 키-값 쌍:', Object.entries(mappingRules || {}));
    console.log('🔧 고정값:', fixedValues);
    
    // 매핑 규칙 검증
    if (mappingRules && Object.keys(mappingRules).length > 0) {
      console.log('✅ 매핑 규칙 검증 결과:');
      Object.entries(mappingRules).forEach(([target, source]) => {
        console.log(`   ${target} ← ${source}`);
      });
    } else {
      console.log('⚠️ 매핑 규칙이 비어있거나 null입니다!');
    }
    
    // 매핑 규칙 데이터
    const mappingData = {
      name: mappingName,
      createdAt: new Date().toISOString(),
      sourceFields,
      targetFields,
      rules: mappingRules,
      fixedValues: fixedValues || {} // 고정값 추가
    };
    
    console.log('💾 최종 저장할 매핑 데이터:', JSON.stringify(mappingData, null, 2));

    // Supabase Storage에 저장 (모든 환경)
    const saveResult = await saveMappingData(mappingName, mappingData);
    if (!saveResult.success) {
      return res.status(500).json({ 
        error: 'Supabase Storage 매핑 저장 실패', 
        details: saveResult.error 
      });
    }
    console.log('✅ Supabase 매핑 저장 성공:', mappingName);

    // 기존 환경별 매핑 저장 (주석 처리)
    /*
    if (process.env.NODE_ENV === 'production') {
      // 프로덕션: Supabase Storage에 저장
      const saveResult = await saveMappingData(mappingName, mappingData);
      if (!saveResult.success) {
        return res.status(500).json({ 
          error: 'Supabase Storage 매핑 저장 실패', 
          details: saveResult.error 
        });
      }
      console.log('✅ Supabase 매핑 저장 성공:', mappingName);
    } else {
      // 개발환경: 로컬 파일로 저장
      const mappingPath = path.join(__dirname, '../file/mappings');
      
      if (!fs.existsSync(mappingPath)) {
        fs.mkdirSync(mappingPath, { recursive: true });
      }

      fs.writeFileSync(
        path.join(mappingPath, `${mappingName}.json`),
        JSON.stringify(mappingData, null, 2)
      );
      console.log('✅ 로컬 매핑 저장 성공:', path.join(mappingPath, `${mappingName}.json`));
    }
    */

    res.json({
      success: true,
      message: '매핑 규칙이 저장되었습니다.',
      mappingId: mappingName
    });

  } catch (error) {
    console.error('❌ 매핑 저장 오류:', error);
    res.status(500).json({ 
      error: '매핑 저장 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📋 발주서 생성 (매핑 규칙 적용)
router.post('/generate', async (req, res) => {
  try {
    const { fileId, mappingId, templateType, supplierFileId } = req.body;
    
    console.log('📋 발주서 생성 요청:', { fileId, mappingId, templateType, supplierFileId });
    
    // 주문서 파일 다운로드
    const downloadResult = await downloadFile(fileId);
    
    if (!downloadResult.success) {
      console.log('❌ 파일 다운로드 실패:', downloadResult.error);
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    console.log('✅ Supabase 파일 다운로드 완료');
    
    // 임시 파일로 저장
    const tempDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFileName = `${fileId}_${Date.now()}.${fileId.split('.').pop()}`;
    const uploadedFilePath = path.join(tempDir, tempFileName);
    
    fs.writeFileSync(uploadedFilePath, downloadResult.data);
    
    // 매핑 규칙 로드
    let mappingRules = {};
    const mappingResult = await loadMappingData(mappingId);
    if (mappingResult.success) {
      mappingRules = mappingResult.data;
      console.log('✅ Supabase 매핑 로드 완료');
    }
    
    // 발주서 템플릿 파일 다운로드 (업로드된 supplier 파일 사용)
    let templatePath = null;
    
    if (supplierFileId) {
      console.log('📋 업로드된 supplier 파일을 템플릿으로 사용:', supplierFileId);
      
      const supplierDownloadResult = await downloadFile(supplierFileId);
      
      if (supplierDownloadResult.success) {
        // 임시 템플릿 파일 저장
        const tempTemplateFileName = `template_${Date.now()}.xlsx`;
        templatePath = path.join(tempDir, tempTemplateFileName);
        fs.writeFileSync(templatePath, supplierDownloadResult.data);
        console.log('✅ 업로드된 supplier 파일을 템플릿으로 다운로드 완료');
      } else {
        console.error('❌ Supplier 파일 다운로드 실패:', supplierDownloadResult.error);
      }
    }
    
    // supplier 파일이 없거나 다운로드 실패 시 기본 템플릿 사용
    if (!templatePath) {
      console.log('⚠️ 기본 템플릿 사용');
      templatePath = path.join(__dirname, '../file/porder_template.xlsx');
    }
    
    // 데이터 변환 및 발주서 생성
    const result = await convertToStandardFormat(uploadedFilePath, templatePath, mappingRules);
    
    console.log('✅ 발주서 생성 완료:', result.fileName);

    // 생성된 발주서를 Supabase Storage에 업로드 (모든 환경)
    const generatedFileBuffer = fs.readFileSync(result.filePath);
    const uploadResult = await uploadFile(generatedFileBuffer, result.fileName, 'generated');
    
    if (uploadResult.success) {
      console.log('✅ 생성된 발주서 Supabase 업로드 완료');
      
      // 임시 파일들 정리
      if (fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
      if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath);
      
      // 임시 템플릿 파일 정리 (업로드된 supplier 파일인 경우)
      if (supplierFileId && templatePath && fs.existsSync(templatePath)) {
        fs.unlinkSync(templatePath);
        console.log('✅ 임시 템플릿 파일 정리 완료');
      }
    } else {
      console.error('❌ 생성된 발주서 Supabase 업로드 실패:', uploadResult.error);
    }

    const downloadUrl = `/api/orders/download/${result.fileName}`;
    
    res.json({
      success: true,
      generatedFile: result.fileName,
      downloadUrl: downloadUrl,
      processedRows: result.processedRows,
      errors: result.errors,
      message: '발주서가 성공적으로 생성되었습니다.'
    });

  } catch (error) {
    console.error('❌ 발주서 생성 오류:', error);
    res.status(500).json({ 
      error: '발주서 생성 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📥 생성된 발주서 다운로드
router.get('/download/:fileName', async (req, res) => {
  try {
    const fileName = req.params.fileName;
    const displayFileName = req.query.display || fileName; // 한글 파일명 지원
    
    console.log('📥 다운로드 요청:', { fileName, displayFileName });
    
    // Supabase Storage에서 다운로드 (모든 환경)
    const downloadResult = await downloadFile(fileName, 'generated');
    
    if (!downloadResult.success) {
      console.log('❌ Supabase 파일 다운로드 실패:', downloadResult.error);
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }

    // 파일 헤더 설정 및 전송 (한글 파일명으로 다운로드)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(displayFileName)}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(downloadResult.data);
    
    console.log('✅ Supabase 파일 다운로드 완료:', { fileName, displayFileName });

    // 기존 환경별 다운로드 처리 (주석 처리)
    /*
    if (process.env.NODE_ENV === 'production') {
      // 프로덕션: Supabase Storage에서 다운로드
      const downloadResult = await downloadFile(fileName, 'generated');
      
      if (!downloadResult.success) {
        console.log('❌ Supabase 파일 다운로드 실패:', downloadResult.error);
        return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
      }

      // 파일 헤더 설정 및 전송
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(downloadResult.data);
      
      console.log('✅ Supabase 파일 다운로드 완료:', fileName);
    } else {
      // 개발환경: 로컬 파일 시스템에서 다운로드
      const filePath = path.join(uploadsDir, fileName);
      
      if (!fs.existsSync(filePath)) {
        console.log('❌ 다운로드 파일을 찾을 수 없음:', filePath);
        return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
      }

      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error('❌ 파일 다운로드 오류:', err);
          res.status(500).json({ error: '파일 다운로드 중 오류가 발생했습니다.' });
        } else {
          console.log('✅ 파일 다운로드 완료:', fileName);
        }
      });
    }
    */

  } catch (error) {
    console.error('❌ 다운로드 오류:', error);
    res.status(500).json({ 
      error: '파일 다운로드 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 📋 템플릿 목록 조회 API
router.get('/templates', (req, res) => {
  try {
    const templatesConfigPath = path.join(__dirname, '../file/templates-config.json');
    
    if (!fs.existsSync(templatesConfigPath)) {
      return res.status(404).json({ 
        error: '템플릿 설정 파일을 찾을 수 없습니다.' 
      });
    }
    
    const templatesConfig = JSON.parse(fs.readFileSync(templatesConfigPath, 'utf8'));
    
    // 각 템플릿의 파일 존재 여부 확인
    const templates = Object.keys(templatesConfig.templates).map(key => {
      const template = templatesConfig.templates[key];
      const templateFilePath = path.join(__dirname, '../file', template.file);
      
      return {
        id: key,
        name: template.name,
        description: template.description,
        file: template.file,
        fields: template.fields,
        available: fs.existsSync(templateFilePath)
      };
    });
    
    res.json({
      success: true,
      templates: templates
    });
    
  } catch (error) {
    console.error('템플릿 목록 조회 오류:', error);
    res.status(500).json({ 
      error: '템플릿 목록을 불러오는 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

// 📝 직접 입력 데이터로 발주서 생성
router.post('/generate-direct', async (req, res) => {
  try {
    const { mappingId, inputData, templateType } = req.body;
    
    console.log('📝 직접 입력 발주서 생성 요청:', { mappingId, inputData, templateType });
    
    // 매핑 규칙 로드
    let mappingRules = {};
    const mappingResult = await loadMappingData(mappingId);
    if (mappingResult.success) {
      mappingRules = mappingResult.data;
      console.log('✅ Supabase 매핑 로드 완료');
    }
    
    // 발주서 템플릿 파일 다운로드 (업로드된 supplier 파일 사용)
    let templatePath = null;
    const { supplierFileId } = req.body;
    
    if (supplierFileId) {
      console.log('📋 업로드된 supplier 파일을 템플릿으로 사용:', supplierFileId);
      
      const supplierDownloadResult = await downloadFile(supplierFileId, 'supplier');
      
      if (supplierDownloadResult.success) {
        // 임시 템플릿 파일 저장
        const tempDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempTemplateFileName = `template_${Date.now()}.xlsx`;
        templatePath = path.join(tempDir, tempTemplateFileName);
        fs.writeFileSync(templatePath, supplierDownloadResult.data);
        console.log('✅ 업로드된 supplier 파일을 템플릿으로 다운로드 완료');
      } else {
        console.error('❌ Supplier 파일 다운로드 실패:', supplierDownloadResult.error);
      }
    }
    
    // supplier 파일이 없거나 다운로드 실패 시 기본 템플릿 사용
    if (!templatePath) {
      console.log('⚠️ 기본 템플릿 사용');
      templatePath = path.join(__dirname, '../file/porder_template.xlsx');
    }
    
    // 직접 입력 데이터를 표준 형식으로 변환
    const { convertDirectInputToStandardFormat } = require('../utils/converter');
    const result = await convertDirectInputToStandardFormat(templatePath, inputData, mappingRules);
    
    console.log('✅ 직접 입력 발주서 생성 완료:', result.fileName);

    // 생성된 발주서를 Supabase Storage에 업로드
    const generatedFileBuffer = fs.readFileSync(result.filePath);
    const uploadResult = await uploadFile(generatedFileBuffer, result.fileName, 'generated');
    
    if (uploadResult.success) {
      console.log('✅ 생성된 발주서 Supabase 업로드 완료');
      // 임시 파일 정리
      if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath);
    } else {
      console.error('❌ 생성된 발주서 Supabase 업로드 실패:', uploadResult.error);
    }

    const downloadUrl = `/api/orders/download/${result.fileName}`;

    res.json({
      success: true,
      message: '직접 입력으로 발주서가 성공적으로 생성되었습니다.',
      generatedFile: result.fileName,
      downloadUrl: downloadUrl,
      inputData: inputData,
      processedRows: 1
    });

  } catch (error) {
    console.error('❌ 직접 입력 발주서 생성 오류:', error);
    res.status(500).json({ 
      error: '직접 입력 발주서 생성 중 오류가 발생했습니다.', 
      details: error.message 
    });
  }
});

// 🤖 AI 자동 매핑
router.post('/ai-mapping', async (req, res) => {
  try {
    const { orderFields, supplierFields } = req.body;
    
    console.log('🤖 AI 자동 매핑 요청:', {
      orderFields: orderFields.length,
      supplierFields: supplierFields.length
    });
    
    // 세션에서 OpenAI API 키 확인
    const { getApiKey } = require('./auth');
    const apiKey = getApiKey(req);
    
    if (!apiKey) {
      return res.status(401).json({ 
        success: false,
        error: 'OpenAI API 키 인증이 필요합니다.',
        requireAuth: true
      });
    }
    
    // AI 매핑 요청 생성
    const prompt = `
다음은 주문서 파일과 발주서 파일의 필드 목록입니다.
주문서 필드를 발주서 필드와 가장 적절하게 매핑해주세요.

주문서 필드 (소스):
${orderFields.map(field => `- ${field}`).join('\n')}

발주서 필드 (타겟):
${supplierFields.map(field => `- ${field}`).join('\n')}

매핑 규칙:
1. 의미적으로 가장 유사한 필드끼리 매핑
2. 상품명, 제품명, 품명 등은 서로 매핑 가능
3. 수량, 개수, 량 등은 서로 매핑 가능
4. 단가, 가격, 금액 등은 서로 매핑 가능
5. 고객명, 이름, 성명 등은 서로 매핑 가능
6. 연락처, 전화번호, 휴대폰 등은 서로 매핑 가능
7. 주소, 배송지, 수령지 등은 서로 매핑 가능
8. 확신이 없는 경우 매핑하지 않음

응답은 반드시 다음 JSON 형식으로만 답변해주세요:
{
  "mappings": {
    "발주서필드명": "주문서필드명",
    "발주서필드명2": "주문서필드명2"
  }
}

다른 설명이나 텍스트는 포함하지 마세요.
`;
    
    // OpenAI API 호출
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: '당신은 데이터 매핑 전문가입니다. 필드명을 분석하여 의미적으로 가장 적절한 매핑을 제공합니다.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const aiResponse = response.data.choices[0].message.content;
    console.log('🤖 AI 응답:', aiResponse);
    
    // JSON 파싱
    let mappings = {};
    try {
      const parsed = JSON.parse(aiResponse);
      mappings = parsed.mappings || {};
    } catch (parseError) {
      console.error('AI 응답 JSON 파싱 실패:', parseError);
      // JSON 파싱 실패 시 간단한 문자열 매칭으로 fallback
      mappings = performSimpleMapping(orderFields, supplierFields);
    }
    
    // 매핑 결과 검증
    const validatedMappings = validateMappings(mappings, orderFields, supplierFields);
    
    console.log('✅ AI 매핑 완료:', {
      totalMappings: Object.keys(validatedMappings).length,
      mappings: validatedMappings
    });
    
    res.json({
      success: true,
      mappings: validatedMappings,
      totalMappings: Object.keys(validatedMappings).length
    });
    
  } catch (error) {
    console.error('❌ AI 매핑 오류:', error);
    
    // API 오류 시 간단한 문자열 매칭으로 fallback
    try {
      const { orderFields, supplierFields } = req.body;
      const fallbackMappings = performSimpleMapping(orderFields, supplierFields);
      
      res.json({
        success: true,
        mappings: fallbackMappings,
        totalMappings: Object.keys(fallbackMappings).length,
        warning: 'AI 매핑에 실패하여 간단한 매칭을 수행했습니다.'
      });
    } catch (fallbackError) {
      res.status(500).json({ 
        error: 'AI 매핑에 실패했습니다.', 
        details: error.message 
      });
    }
  }
});

// 간단한 문자열 매칭 함수
function performSimpleMapping(orderFields, supplierFields) {
  const mappings = {};
  
  // 확장된 매핑 규칙 정의
  const mappingRules = [
    { patterns: ['상품명', '제품명', '품명', '상품', '제품', 'product', 'item'], priority: 1 },
    { patterns: ['수량', '개수', '량', 'qty', 'quantity', '갯수'], priority: 2 },
    { patterns: ['단가', '가격', '금액', 'price', 'amount', '비용', '원가'], priority: 3 },
    { patterns: ['고객명', '이름', '성명', '고객', '구매자', 'name', 'customer'], priority: 4 },
    { patterns: ['연락처', '전화번호', '휴대폰', '전화', 'phone', 'tel', '핸드폰'], priority: 5 },
    { patterns: ['주소', '배송지', '수령지', '배송주소', 'address', '소재지'], priority: 6 },
    { patterns: ['발주번호', '주문번호', '번호', 'order', 'no'], priority: 7 },
    { patterns: ['일자', '날짜', '시간', 'date', 'time'], priority: 8 },
    { patterns: ['공급가액', '총액', '합계', 'total', 'sum'], priority: 9 },
    { patterns: ['비고', '메모', '참고', 'note', 'memo', 'comment'], priority: 10 }
  ];
  
  supplierFields.forEach(supplierField => {
    for (const rule of mappingRules) {
      const matchingOrderField = orderFields.find(orderField => {
        return rule.patterns.some(pattern => 
          orderField.toLowerCase().includes(pattern.toLowerCase()) &&
          supplierField.toLowerCase().includes(pattern.toLowerCase())
        );
      });
      
      if (matchingOrderField && !mappings[supplierField]) {
        mappings[supplierField] = matchingOrderField;
        break;
      }
    }
  });
  
  return mappings;
}

// 매핑 결과 검증
function validateMappings(mappings, orderFields, supplierFields) {
  const validatedMappings = {};
  
  Object.entries(mappings).forEach(([targetField, sourceField]) => {
    // 타겟 필드가 실제로 존재하는지 확인
    if (supplierFields.includes(targetField) && orderFields.includes(sourceField)) {
      validatedMappings[targetField] = sourceField;
    }
  });
  
  return validatedMappings;
}

// 🚀 템플릿 기반 자동 변환 및 발주서 생성
router.post('/generate-with-template', async (req, res) => {
  try {
    const { fileId, templateId, templateType } = req.body;
    
    console.log('🚀 템플릿 기반 자동 변환 시작:', {
      fileId,
      templateId, 
      templateType: templateType || 'standard'
    });
    
    if (!fileId || !templateId) {
      return res.status(400).json({ 
        error: '파일 ID와 템플릿 ID가 필요합니다.' 
      });
    }
    
    // 1. 템플릿 정보 가져오기
    const { supabase } = require('../utils/supabase');
    const { data: template, error: templateError } = await supabase
      .from('order_templates')
      .select('*')
      .eq('id', templateId)
      .eq('is_active', true)
      .single();
    
    if (templateError || !template) {
      console.error('❌ 템플릿 조회 오류:', templateError);
      return res.status(404).json({ 
        error: '템플릿을 찾을 수 없습니다.' 
      });
    }
    
    console.log('✅ 템플릿 정보 로드:', template.template_name);
    
    // 2. 주문서 파일 다운로드 및 데이터 읽기 (모든 환경에서 Supabase Storage 사용)
    console.log('📥 Supabase Storage에서 파일 다운로드 중:', fileId);
    
    const downloadResult = await downloadFile(fileId);
    if (!downloadResult.success) {
      console.error('❌ 파일 다운로드 실패:', {
        fileId: fileId,
        error: downloadResult.error
      });
      return res.status(404).json({ 
        error: '파일을 찾을 수 없습니다.',
        details: downloadResult.error 
      });
    }
    
    const fileBuffer = downloadResult.data;
    console.log('✅ 파일 다운로드 성공:', {
      fileId: fileId,
      bufferSize: fileBuffer.length
    });
    
    // 3. 엑셀 데이터 읽기 (메타데이터 오류 방지)
    const workbook = new ExcelJS.Workbook();
    
    // ExcelJS 메타데이터 기본값 설정 (company 오류 방지)
    workbook.creator = 'AutoOrder System';
    workbook.company = 'AutoOrder';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    try {
      await workbook.xlsx.load(fileBuffer);
    } catch (loadError) {
      console.error('❌ ExcelJS 로드 오류:', loadError);
      // 메타데이터 오류인 경우 다시 시도
      if (loadError.message.includes('company') || loadError.message.includes('properties')) {
        console.log('🔄 메타데이터 무시하고 재시도...');
        const newWorkbook = new ExcelJS.Workbook();
        // 메타데이터 처리 비활성화
        await newWorkbook.xlsx.load(fileBuffer, { ignoreCalculatedFields: true });
        workbook.worksheets = newWorkbook.worksheets;
      } else {
        throw loadError;
      }
    }
    
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) {
      return res.status(400).json({ 
        error: '워크시트를 찾을 수 없습니다.' 
      });
    }
    
    // 4. 헤더와 데이터 추출
    const rawData = [];
    worksheet.eachRow((row, rowNumber) => {
      const rowData = [];
      row.eachCell((cell, colNumber) => {
        // ⚠️ CRITICAL: cell.value를 직접 수정하지 말고 복사해서 처리
        const originalValue = cell.value;
        let processedValue = originalValue;
        
        // 객체를 문자열로 변환 (ExcelJS 특수 타입 처리)
        if (processedValue && typeof processedValue === 'object') {
          // ExcelJS 특수 타입 처리
          if (processedValue.richText && Array.isArray(processedValue.richText)) {
            // 리치 텍스트 배열에서 text 속성만 추출
            processedValue = processedValue.richText.map(item => item.text || '').join('');
          } else if (processedValue.text !== undefined) {
            // 하이퍼링크 또는 단순 텍스트
            processedValue = processedValue.text;
          } else if (processedValue.result !== undefined) {
            // 수식 결과
            processedValue = processedValue.result;
          } else if (processedValue.valueOf && typeof processedValue.valueOf === 'function') {
            // 날짜 또는 숫자 객체
            processedValue = processedValue.valueOf();
          } else if (Array.isArray(processedValue)) {
            processedValue = processedValue.join(', ');
          } else if (processedValue.toString && typeof processedValue.toString === 'function') {
            const toStringResult = processedValue.toString();
            if (toStringResult !== '[object Object]') {
              processedValue = toStringResult;
            } else {
              processedValue = JSON.stringify(processedValue);
            }
          } else {
            processedValue = JSON.stringify(processedValue);
          }
        }
        
        const finalValue = processedValue ? String(processedValue).trim() : '';
        rowData.push(finalValue);
      });
      rawData.push(rowData);
    });
    
    if (rawData.length === 0) {
      return res.status(400).json({ 
        error: '파일에 데이터가 없습니다.' 
      });
    }
    
    const orderHeaders = rawData[0];
    const orderData = rawData.slice(1).filter(row => row.some(cell => cell));
    
    console.log('📊 주문서 데이터:', {
      headers: orderHeaders,
      dataRows: orderData.length
    });
    
    // 5. 템플릿 매핑 적용하여 데이터 변환
    const orderMapping = template.order_field_mapping;
    const supplierMapping = template.supplier_field_mapping;
    const fixedFields = template.fixed_fields || {};
    
    console.log('📋 템플릿 매핑:', {
      orderMapping,
      supplierMapping,
      fixedFields
    });
    
    // 매핑 데이터 검증
    if (!supplierMapping || Object.keys(supplierMapping).length === 0) {
      console.error('❌ 템플릿 매핑 오류: supplier_field_mapping이 비어있음');
      return res.status(400).json({ 
        error: '템플릿의 공급업체 필드 매핑이 설정되지 않았습니다. 템플릿을 다시 설정해주세요.' 
      });
    }
    
    if (!orderMapping || Object.keys(orderMapping).length === 0) {
      console.error('❌ 템플릿 매핑 오류: order_field_mapping이 비어있음');
      return res.status(400).json({ 
        error: '템플릿의 주문서 필드 매핑이 설정되지 않았습니다. 템플릿을 다시 설정해주세요.' 
      });
    }
    
    // 6. 변환된 데이터 생성
    const convertedData = [];
    const supplierHeaders = Object.keys(supplierMapping);
    
    // 헤더 추가
    convertedData.push(supplierHeaders);
    
    // 데이터 변환
    orderData.forEach((orderRow, index) => {
      const convertedRow = [];
      
      supplierHeaders.forEach(supplierField => {
        let value = '';
        
        // 고정값이 있으면 사용
        if (fixedFields[supplierField]) {
          value = fixedFields[supplierField];
        } else {
          // 매핑된 주문서 필드에서 값 가져오기
          const orderField = supplierMapping[supplierField];
          if (orderField && orderMapping[orderField]) {
            const orderColumnName = orderMapping[orderField];
            const orderColumnIndex = orderHeaders.indexOf(orderColumnName);
            if (orderColumnIndex !== -1 && orderRow[orderColumnIndex]) {
              const rawValue = orderRow[orderColumnIndex];
              
              // 객체를 문자열로 변환 (읽기 전용 처리)
              if (rawValue && typeof rawValue === 'object') {
                let processedValue = rawValue;
                if (processedValue.richText && Array.isArray(processedValue.richText)) {
                  // 리치 텍스트 처리
                  value = processedValue.richText.map(item => item.text || '').join('');
                } else if (Array.isArray(processedValue)) {
                  value = processedValue.join(', ');
                } else if (processedValue.toString && typeof processedValue.toString === 'function') {
                  const toStringResult = processedValue.toString();
                  value = toStringResult !== '[object Object]' ? toStringResult : JSON.stringify(processedValue);
                } else {
                  value = JSON.stringify(processedValue);
                }
              } else {
                value = String(rawValue).trim();
              }
            }
          }
        }
        
        convertedRow.push(value);
      });
      
      convertedData.push(convertedRow);
    });
    
    console.log('🔄 데이터 변환 완료:', {
      originalRows: orderData.length,
      convertedRows: convertedData.length - 1
    });
    
    // 7. 발주서 파일 생성 (메타데이터 설정)
    const outputWorkbook = new ExcelJS.Workbook();
    
    // 출력 워크북 메타데이터 설정 (오류 방지)
    outputWorkbook.creator = 'AutoOrder System';
    outputWorkbook.company = 'AutoOrder';
    outputWorkbook.created = new Date();
    outputWorkbook.modified = new Date();
    outputWorkbook.subject = '발주서';
    outputWorkbook.description = '자동 생성된 발주서';
    
    const outputWorksheet = outputWorkbook.addWorksheet('발주서');
    
    // 데이터 추가
    convertedData.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        const cell = outputWorksheet.getCell(rowIndex + 1, colIndex + 1);
        
        // 객체를 문자열로 변환 (읽기 전용 처리)
        let processedCellValue = value;
        if (processedCellValue && typeof processedCellValue === 'object') {
          if (Array.isArray(processedCellValue)) {
            processedCellValue = processedCellValue.join(', ');
          } else if (processedCellValue.toString && typeof processedCellValue.toString === 'function') {
            const toStringResult = processedCellValue.toString();
            processedCellValue = toStringResult !== '[object Object]' ? toStringResult : JSON.stringify(processedCellValue);
          } else {
            processedCellValue = JSON.stringify(processedCellValue);
          }
        }
        
        cell.value = processedCellValue;
        
        // 헤더 스타일링
        if (rowIndex === 0) {
          cell.font = { bold: true };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE6E6E6' }
          };
        }
      });
    });
    
    // 자동 열 너비 조정
    outputWorksheet.columns.forEach(column => {
      column.width = 15;
    });
    
    // 8. 파일 저장 (모든 환경에서 Supabase Storage 사용)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Supabase Storage 호환 파일명 생성 (URL 인코딩 방식)
    const templateNameSafe = encodeURIComponent(template.template_name)
      .replace(/[%]/g, '_') // % 기호를 언더스코어로 변경
      .replace(/[^a-zA-Z0-9_-]/g, '_') // 영문, 숫자, _, - 만 허용
      .replace(/_+/g, '_') // 연속 언더스코어를 하나로
      .replace(/^_|_$/g, '') // 시작/끝 언더스코어 제거
      .substring(0, 30) // 길이 제한
      || 'template'; // 빈 문자열인 경우 기본값
    
    const outputFileName = `order_${templateNameSafe}_${timestamp}.xlsx`;
    
    console.log('💾 발주서 파일 Supabase Storage 저장 중:', outputFileName);
    
    // Supabase Storage에 저장
    const buffer = await outputWorkbook.xlsx.writeBuffer();
    const uploadResult = await uploadFile(buffer, outputFileName, 'generated');
    
    if (!uploadResult.success) {
      return res.status(500).json({ 
        error: 'Supabase Storage 저장 실패',
        details: uploadResult.error 
      });
    }
    
    console.log('✅ Supabase Storage 저장 완료:', outputFileName);
    
    // 9. 다운로드 URL 및 사용자 친화적 파일명 생성
    const userFriendlyFileName = `발주서_${template.template_name}_${timestamp}.xlsx`;
    const downloadUrl = `/api/orders/download/${outputFileName}?display=${encodeURIComponent(userFriendlyFileName)}`;
    
    console.log('🎉 템플릿 기반 변환 완료:', {
      template: template.template_name,
      processedRows: orderData.length,
      outputFile: outputFileName,
      userFriendlyFileName: userFriendlyFileName
    });
    
    res.json({
      success: true,
      message: '템플릿 기반 발주서 생성이 완료되었습니다.',
      generatedFile: outputFileName,
      displayFileName: userFriendlyFileName,
      downloadUrl: downloadUrl,
      processedRows: orderData.length,
      templateUsed: template.template_name,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 템플릿 기반 변환 오류:', error);
    res.status(500).json({ 
      error: '템플릿 기반 변환 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

module.exports = router; 