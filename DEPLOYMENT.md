# 🚀 배포 가이드

이 프로젝트는 **Render**와 **Vercel** 두 플랫폼 모두에서 배포 가능하도록 설계되었습니다.

## 🎯 플랫폼별 특징 비교

| 항목 | Render | Vercel |
|------|--------|--------|
| **배포 방식** | Always-On 서버 | Serverless Functions |
| **XLS 처리** | 제한적 | 더 나은 성능 예상 |
| **타임아웃** | 60초 | 30초 |
| **파일 크기** | 20MB | 10MB |
| **비용** | 저렴 | 규모에 따라 비쌈 |
| **메모리** | 512MB | 함수별 최적화 |

## 🔧 Vercel 배포 (신규)

### 1. 사전 준비
```bash
# Vercel CLI 설치
npm i -g vercel

# 프로젝트 클론
git clone your-repo
cd autorder-main
npm install
```

### 2. 환경 변수 설정
Vercel 대시보드에서 다음 환경 변수를 설정하세요:

**필수 환경 변수:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-gmail-app-password
JWT_SECRET=your-jwt-secret-key
SESSION_SECRET=autorder-session-secret-key-2024
WEBHOOK_API_KEY=webhook_2025_secure_key_abc123xyz789
WEBHOOK_EMAIL_RECIPIENT=orders@yourcompany.com
```

**선택적 환경 변수:**
```env
OPENAI_API_KEY=sk-proj-your-openai-api-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
```

### 3. 배포 명령어
```bash
# 첫 배포
vercel

# 프로덕션 배포
vercel --prod

# 또는 npm 스크립트 사용
npm run deploy:vercel
```

### 4. 도메인 설정
- Vercel 대시보드에서 커스텀 도메인 연결
- 자동 HTTPS 적용

## 🚀 Render 배포 (기존)

### 1. GitHub 연결
- Render 대시보드에서 GitHub 레포지토리 연결

### 2. 환경 변수 설정
위와 동일한 환경 변수를 Render 대시보드에서 설정

### 3. 배포 설정
```yaml
# render.yaml (이미 설정됨)
services:
  - type: web
    name: autorder-system
    env: node
    buildCommand: npm install
    startCommand: npm start
```

### 4. 배포
```bash
# Git push로 자동 배포
git push origin main

# 또는 npm 스크립트 사용
npm run deploy:render
```

## 🔄 플랫폼 간 전환

### Render → Vercel 이전
1. Vercel에서 새 프로젝트 생성
2. 동일한 환경 변수 설정
3. 도메인 변경
4. DNS 업데이트

### Vercel → Render 이전
1. Render에서 새 서비스 생성
2. 동일한 환경 변수 설정
3. 도메인 변경
4. DNS 업데이트

## 📊 성능 최적화

### Vercel 최적화
- **파일 크기**: 10MB 이하 권장
- **처리 시간**: 30초 이내
- **XLS 파일**: 5초 내 처리 또는 변환 권장

### Render 최적화
- **파일 크기**: 20MB 이하
- **처리 시간**: 60초 이내
- **XLS 파일**: 10초 내 처리

## 🚨 문제 해결

### Vercel 함수 타임아웃
```
Error: Function execution timed out
```
**해결**: 파일 크기를 줄이거나 .xls → .xlsx 변환

### Render 메모리 부족
```
Error: JavaScript heap out of memory
```
**해결**: 파일을 작은 단위로 분할 처리

### 공통 문제
- **Supabase 연결 실패**: 환경 변수 확인
- **이메일 전송 실패**: Gmail 앱 비밀번호 확인
- **파일 업로드 실패**: 파일 형식 및 크기 확인

## 🛠️ 개발 환경

### 로컬 개발
```bash
# 개발 서버 실행
npm run dev

# 접속
http://localhost:3000
```

### 환경 변수 파일
```bash
# .env 파일 생성 (위의 환경 변수 참고)
cp .env.example .env
# 실제 값으로 수정
```

## 📈 모니터링

### Vercel
- 대시보드에서 함수 실행 시간 모니터링
- 에러 로그 확인

### Render
- 대시보드에서 메모리 사용량 모니터링
- 서비스 로그 확인

## 🎯 추천 사용법

### 소규모 프로젝트
- **Vercel**: 빠른 배포, XLS 처리 개선 기대
- 비용 효율적

### 대규모 프로젝트
- **Render**: 안정적인 성능, 예측 가능한 비용
- 큰 파일 처리에 유리

### 하이브리드 운영
- **개발/테스트**: Vercel (빠른 배포)
- **프로덕션**: Render (안정성)

## 📞 지원

문제 발생 시:
1. 로그 확인 (Vercel Functions 또는 Render Service)
2. 환경 변수 재확인
3. 파일 크기/형식 확인
4. 플랫폼별 제한사항 검토 