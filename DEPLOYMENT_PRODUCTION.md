# 🚀 프로덕션 배포 가이드

## 📋 배포 전 체크리스트

### ✅ 필수 환경변수 설정
```bash
# 기본 설정
NODE_ENV=production
PORT=3000

# Supabase 설정 (필수)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key

# Gmail 설정 (메일 전송용 - 필수)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password

# 런모아 플랫폼 연동 (선택사항)
WEBHOOK_API_KEY=your-secure-webhook-api-key
WEBHOOK_EMAIL_RECIPIENT=orders@yourcompany.com

# OpenAI API 설정 (AI 자동 매핑용 - 선택사항)
OPENAI_API_KEY=sk-proj-your-openai-api-key

# 관리자 계정 설정 (선택사항)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
```

### 🛠️ 코드 정리 완료 사항
- ✅ Console.log 최소화 (에러 로그만 유지)
- ✅ 디버깅 메시지 제거
- ✅ 개발용 주석 정리
- ✅ 브라우저 환경별 로그 분리
- ✅ 서버 시작 메시지 최적화
- ✅ 파일 처리 로그 간소화

### 🎯 배포 플랫폼별 설정

#### Render 배포
1. GitHub에 코드 푸시
2. Render 대시보드에서 New Web Service 생성
3. 환경변수 설정
4. 자동 배포 완료

#### Vercel 배포
```bash
npm run deploy:vercel
```

#### 로컬 프로덕션 테스트
```bash
NODE_ENV=production npm start
```

## 🔧 성능 최적화

### 메모리 최적화
- 최대 메모리: 512MB
- Garbage Collection 활성화
- Keep-alive 연결 설정

### 요청 타임아웃
- Vercel: 30초
- Render: 60초
- 로컬: 무제한

## 🐛 문제 해결

### 메모리 부족 시
```bash
# 메모리 한도 증가
node --expose-gc --max-old-space-size=1024 server.js
```

### 파일 업로드 실패 시
- 파일 크기 10MB 이하 확인
- Supabase Storage 설정 확인
- 네트워크 연결 상태 확인

### 환경변수 누락 시
- 모든 필수 환경변수 설정 확인
- .env 파일 인코딩 UTF-8 확인
- 플랫폼별 환경변수 설정 확인

## 📊 모니터링

### 로그 레벨
- **프로덕션**: ERROR만 출력
- **개발**: 모든 로그 출력

### 상태 확인
- `/api/webhook/status` - API 상태 확인
- 메모리 사용량 자동 모니터링
- 요청 처리 시간 추적

## 🔐 보안

### API 키 관리
- 환경변수로만 관리
- .env 파일은 Git에 포함하지 않음
- 프로덕션에서 키 로테이션 권장

### 접근 제한
- CORS 설정 확인
- 관리자 계정 보안 강화
- Webhook API 키 보안 관리 