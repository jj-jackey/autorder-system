const express = require('express');
const axios = require('axios');
const router = express.Router();

// 🔐 관리자 로그인
router.post('/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('🔐 관리자 로그인 시도');
    
    // 환경변수에서 관리자 계정 정보 확인
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin4321';
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '사용자명과 비밀번호를 입력해주세요.'
      });
    }
    
    if (username !== adminUsername || password !== adminPassword) {
      return res.status(401).json({
        success: false,
        error: '잘못된 관리자 계정 정보입니다.'
      });
    }
    
    // 환경변수에서 OpenAI API 키 확인
    const systemApiKey = process.env.OPENAI_API_KEY;
    if (!systemApiKey) {
      return res.status(500).json({
        success: false,
        error: '시스템 OpenAI API 키가 설정되지 않았습니다. 관리자에게 문의하세요.'
      });
    }
    
    // 관리자 세션 설정
    req.session.isAdmin = true;
    req.session.openaiApiKey = systemApiKey;
    req.session.authenticated = true;
    req.session.authenticatedAt = new Date().toISOString();
    req.session.username = username;
    
    console.log('✅ 관리자 로그인 성공');
    
    res.json({
      success: true,
      message: '관리자로 성공적으로 로그인되었습니다.',
      authenticatedAt: req.session.authenticatedAt,
      isAdmin: true
    });
    
  } catch (error) {
    console.error('❌ 관리자 로그인 오류:', error);
    res.status(500).json({
      success: false,
      error: '서버 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

// 🔐 API 키 검증
router.post('/verify', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    console.log('🔐 API 키 검증 요청');
    
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API 키가 제공되지 않았습니다.'
      });
    }
    
    if (!apiKey.startsWith('sk-')) {
      return res.status(400).json({
        success: false,
        error: '올바른 OpenAI API 키 형식이 아닙니다. sk-로 시작해야 합니다.'
      });
    }
    
    // OpenAI API 키 검증 요청
    try {
      console.log('🤖 OpenAI API 키 유효성 검사 중...');
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        max_tokens: 1
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10초 타임아웃
      });
      
      // API 키가 유효하면 세션에 저장
      req.session.openaiApiKey = apiKey;
      req.session.authenticated = true;
      req.session.authenticatedAt = new Date().toISOString();
      
      console.log('✅ OpenAI API 키 검증 성공');
      
      res.json({
        success: true,
        message: 'API 키가 성공적으로 검증되었습니다.',
        authenticatedAt: req.session.authenticatedAt
      });
      
    } catch (openaiError) {
      console.error('❌ OpenAI API 키 검증 실패:', openaiError.response?.data || openaiError.message);
      
      let errorMessage = 'API 키 검증에 실패했습니다.';
      
      if (openaiError.response?.status === 401) {
        errorMessage = '유효하지 않은 API 키입니다. 올바른 OpenAI API 키를 입력해주세요.';
      } else if (openaiError.response?.status === 429) {
        errorMessage = 'API 사용량 한도를 초과했습니다. OpenAI 계정을 확인해주세요.';
      } else if (openaiError.response?.status === 403) {
        errorMessage = 'API 키 권한이 없습니다. OpenAI 계정 설정을 확인해주세요.';
      } else if (openaiError.code === 'ECONNABORTED') {
        errorMessage = '네트워크 연결 시간이 초과되었습니다. 다시 시도해주세요.';
      }
      
      res.status(400).json({
        success: false,
        error: errorMessage
      });
    }
    
  } catch (error) {
    console.error('❌ API 키 검증 오류:', error);
    res.status(500).json({
      success: false,
      error: '서버 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

// 🔍 인증 상태 확인
router.get('/check', (req, res) => {
  try {
    const authenticated = req.session.authenticated === true && req.session.openaiApiKey;
    const isAdmin = req.session.isAdmin === true;
    
    console.log('🔍 인증 상태 확인:', {
      authenticated,
      isAdmin,
      sessionId: req.session.id,
      hasApiKey: !!req.session.openaiApiKey,
      username: req.session.username
    });
    
    res.json({
      authenticated,
      authenticatedAt: req.session.authenticatedAt || null,
      isAdmin,
      username: req.session.username || null
    });
    
  } catch (error) {
    console.error('❌ 인증 상태 확인 오류:', error);
    res.json({ authenticated: false, isAdmin: false });
  }
});

// 🚪 로그아웃
router.post('/logout', (req, res) => {
  try {
    console.log('🚪 로그아웃 요청:', req.session.id);
    
    req.session.destroy((error) => {
      if (error) {
        console.error('❌ 세션 삭제 오류:', error);
        return res.status(500).json({
          success: false,
          error: '로그아웃 중 오류가 발생했습니다.'
        });
      }
      
      console.log('✅ 로그아웃 완료');
      res.json({
        success: true,
        message: '성공적으로 로그아웃되었습니다.'
      });
    });
    
  } catch (error) {
    console.error('❌ 로그아웃 오류:', error);
    res.status(500).json({
      success: false,
      error: '로그아웃 중 오류가 발생했습니다.'
    });
  }
});

// 🛡️ 인증 미들웨어
function requireAuth(req, res, next) {
  if (req.session.authenticated && req.session.openaiApiKey) {
    return next();
  }
  
  // API 요청인 경우 JSON 응답
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      success: false,
      error: 'API 키 인증이 필요합니다.',
      requireAuth: true
    });
  }
  
  // 일반 페이지 요청인 경우 인증 페이지로 리디렉션
  res.redirect('/auth.html');
}

// 🔑 세션에서 API 키 가져오기
function getApiKey(req) {
  return req.session.openaiApiKey || null;
}

module.exports = {
  router,
  requireAuth,
  getApiKey
}; 