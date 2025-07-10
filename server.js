const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
      console.log('✅ 서버 파일명 디코딩 성공:', { original: fileName, decoded: decoded });
      return decoded;
    }
    
    // URI 디코딩 시도
    try {
      const uriDecoded = decodeURIComponent(fileName);
      if (uriDecoded !== fileName) {
        console.log('✅ 서버 파일명 URI 디코딩 성공:', { original: fileName, decoded: uriDecoded });
        return uriDecoded;
      }
    } catch (e) {
      // URI 디코딩 실패 시 무시
    }
    
    console.log('⚠️ 서버 파일명 디코딩 실패, 원본 사용:', fileName);
    return fileName;
  } catch (error) {
    console.error('❌ 서버 파일명 디코딩 오류:', error.message);
    return fileName;
  }
}

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// uploads 폴더는 임시 파일 처리용으로만 사용 (Supabase Storage가 메인)
const uploadsDir = path.join(__dirname, 'uploads');

// 기존 자동 폴더 생성 코드 (주석 처리 - 필요시에만 생성)
/*
if (process.env.NODE_ENV !== 'production' && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 uploads 폴더가 생성되었습니다:', uploadsDir);
}
*/

// 세션 설정
app.use(session({
  secret: process.env.SESSION_SECRET || 'autorder-session-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // HTTPS가 아닌 환경에서도 동작하도록
    maxAge: 24 * 60 * 60 * 1000 // 24시간
  }
}));

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 파일 업로드 설정 - Supabase Storage 사용 (로컬에서도 테스트)
const storage = multer.memoryStorage(); // 모든 환경에서 Supabase 사용

// 기존 로컬 파일 시스템 설정 (주석 처리)
/*
const storage = process.env.NODE_ENV === 'production' 
  ? multer.memoryStorage()  // 프로덕션: 메모리에 임시 저장 후 Supabase로 업로드
  : multer.diskStorage({    // 개발환경: 디스크 저장
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
  fileFilter: (req, file, cb) => {
    const decodedFileName = decodeFileName(file.originalname);
    
    console.log('🔍 서버 파일 필터 검사:', {
      originalname: decodedFileName,
      rawOriginalname: file.originalname,
      mimetype: file.mimetype
    });
    
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(decodedFileName).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                     file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     file.mimetype === 'application/vnd.ms-excel' ||
                     file.mimetype === 'text/csv' ||
                     file.mimetype === 'application/octet-stream'; // 일부 브라우저에서 Excel을 이렇게 인식
    
    if (mimetype && extname) {
      console.log('✅ 서버 파일 필터 통과');
      return cb(null, true);
    } else {
      console.log('❌ 서버 파일 필터 실패:', { mimetype, extname, decodedFileName });
      cb(new Error('파일 형식이 지원되지 않습니다. Excel(.xlsx, .xls) 또는 CSV 파일만 업로드 가능합니다.'));
    }
  },
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB로 증가
    fieldSize: 2 * 1024 * 1024   // 2MB
  }
});

// API 라우트
const orderRoutes = require('./routes/orders');
const emailRoutes = require('./routes/email');
const templateRoutes = require('./routes/templates');
const { router: authRoutes, requireAuth } = require('./routes/auth');

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/templates', templateRoutes);

// 홈페이지 라우트 - 인증 상태에 따라 분기
app.get('/', (req, res) => {
  // 인증 상태 확인
  const authenticated = req.session.authenticated === true && req.session.openaiApiKey;
  
  if (authenticated) {
    // 인증된 경우 메인 페이지 표시
    console.log('✅ 인증된 사용자 - index.html 제공');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    // 인증되지 않은 경우 인증 페이지 표시
    console.log('🔐 인증되지 않은 사용자 - auth.html 제공');
    res.sendFile(path.join(__dirname, 'public', 'auth.html'));
  }
});

// index.html 직접 접근 보호
app.get('/index.html', (req, res) => {
  // 인증 상태 확인
  const authenticated = req.session.authenticated === true && req.session.openaiApiKey;
  
  if (authenticated) {
    console.log('✅ 인증된 사용자 - index.html 직접 접근 허용');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    console.log('🔐 인증되지 않은 사용자 - auth.html로 리다이렉트');
    res.redirect('/');
  }
});

// 에러 핸들링
app.use((error, req, res, next) => {
  console.error('🚨 서버 에러:', {
    error: error.message,
    code: error.code,
    type: error.constructor.name,
    timestamp: new Date().toISOString()
  });
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: '파일 크기가 너무 큽니다. 50MB 이하의 파일을 업로드해주세요.',
        code: 'LIMIT_FILE_SIZE'
      });
    }
    if (error.code === 'LIMIT_FIELD_SIZE') {
      return res.status(400).json({ 
        error: '필드 크기가 너무 큽니다.',
        code: 'LIMIT_FIELD_SIZE'
      });
    }
  }
  
  res.status(500).json({ 
    error: error.message,
    code: error.code || 'UNKNOWN_ERROR'
  });
});

app.listen(PORT, async () => {
  console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`📁 파일 업로드: http://localhost:${PORT}`);
  console.log(`☁️ 스토리지: Supabase Storage (모든 환경)`);
  console.log(`🔗 Supabase URL: ${process.env.SUPABASE_URL ? '✅ 연결됨' : '❌ 설정안됨'}`);
  
  // Render 환경에서 Supabase 연결 상태 확인
  if (process.env.NODE_ENV === 'production') {
    try {
      console.log('🔍 Supabase 연결 상태 확인 중...');
      const { data, error } = await supabase.storage.listBuckets();
      
      if (error) {
        console.error('❌ Supabase Storage 연결 실패:', error.message);
        console.log('💡 환경 변수를 확인해주세요: SUPABASE_URL, SUPABASE_ANON_KEY');
      } else {
        console.log('✅ Supabase Storage 연결 성공:', data.map(b => b.name).join(', '));
      }
    } catch (connectError) {
      console.error('❌ Supabase 연결 테스트 실패:', connectError.message);
      console.log('⚠️ 네트워크 상태를 확인해주세요. 서비스는 계속 실행됩니다.');
    }
  }
  
  // Node.js 네트워크 설정 최적화 (Render 환경용)
  if (process.env.NODE_ENV === 'production') {
    // Keep-alive 연결 설정
    const http = require('http');
    const https = require('https');
    
    const keepAliveAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 60000,
      freeSocketTimeout: 30000
    });
    
    // 글로벌 에이전트 설정
    https.globalAgent = keepAliveAgent;
    
    console.log('⚡ Keep-alive 연결 설정 완료 (Render 최적화)');
  }
}); 