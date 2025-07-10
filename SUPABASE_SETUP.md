# Supabase Storage 설정 가이드

## 🚀 **문제 해결**
Render와 같은 클라우드 플랫폼은 **Ephemeral Filesystem**을 사용하여 파일이 임시로만 저장되고 재배포 시 사라집니다. 이 문제를 해결하기 위해 **Supabase Storage**를 사용하여 파일을 영구적으로 저장합니다.

## 📋 **1. Supabase 프로젝트 생성**

### 1.1 계정 생성 및 프로젝트 만들기
1. [Supabase](https://supabase.com)에 접속하여 계정 생성
2. **"New Project"** 클릭
3. 프로젝트 이름, 데이터베이스 비밀번호 설정
4. 리전 선택 (한국: **Northeast Asia (Seoul)**)
5. 프로젝트 생성 대기 (약 2분)

### 1.2 API Keys 확인
1. 프로젝트 대시보드 → **Settings** → **API**
2. 다음 정보 복사:
   - **Project URL**: `https://your-project-id.supabase.co`
   - **anon public key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## 🗂️ **2. Storage 버킷 생성**

### 2.1 업로드 파일용 버킷
1. 왼쪽 메뉴 → **Storage**
2. **"Create a new bucket"** 클릭
3. 버킷 설정:
   - **Name**: `uploads`
   - **Public bucket**: ✅ (체크)
   - **File size limit**: `10MB`
   - **Allowed MIME types**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv`

### 2.2 매핑 데이터용 버킷  
1. **"Create a new bucket"** 클릭
2. 버킷 설정:
   - **Name**: `mappings`
   - **Public bucket**: ✅ (체크)
   - **File size limit**: `1MB`
   - **Allowed MIME types**: `application/json`

### 2.3 생성된 발주서용 버킷
1. **"Create a new bucket"** 클릭  
2. 버킷 설정:
   - **Name**: `generated`
   - **Public bucket**: ✅ (체크)
   - **File size limit**: `50MB`
   - **Allowed MIME types**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

## ⚙️ **3. 환경 변수 설정**

### 3.1 로컬 개발환경 (.env 파일)
```env
# 기존 환경 변수
NODE_ENV=development
PORT=3000

# Supabase 설정 추가
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 메일 설정 (기존)
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password
```

### 3.2 Render 배포 환경 변수
Render 대시보드에서 다음 환경 변수 추가:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `GMAIL_USER` | `your-email@gmail.com` |
| `GMAIL_APP_PASSWORD` | `your-app-password` |

## 🛠️ **4. 패키지 설치**

```bash
npm install @supabase/supabase-js
```

## 🔒 **5. Storage 정책 설정 (선택사항)**

더 세밀한 권한 제어를 원한다면:

### 5.1 RLS (Row Level Security) 설정
```sql
-- uploads 버킷 정책
CREATE POLICY "Allow public uploads" ON storage.objects 
FOR INSERT WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "Allow public downloads" ON storage.objects 
FOR SELECT USING (bucket_id = 'uploads');

-- mappings 버킷 정책  
CREATE POLICY "Allow public mappings" ON storage.objects 
FOR ALL USING (bucket_id = 'mappings');

-- generated 버킷 정책
CREATE POLICY "Allow public generated" ON storage.objects 
FOR ALL USING (bucket_id = 'generated');
```

## 🎯 **6. 동작 방식**

### 개발환경 (`NODE_ENV=development`)
- 파일이 로컬 `uploads/` 폴더에 저장
- 매핑 데이터가 `file/mappings/` 폴더에 저장

### 프로덕션환경 (`NODE_ENV=production`)  
- 파일이 Supabase Storage에 저장
- 매핑 데이터가 Supabase Storage에 저장
- 모든 파일 작업이 클라우드에서 처리

## ✅ **7. 테스트**

1. **로컬 테스트**:
   ```bash
   npm run dev
   ```

2. **Render 배포 후 테스트**:
   - 파일 업로드 → Supabase Storage `uploads` 버킷 확인
   - 매핑 저장 → Supabase Storage `mappings` 버킷 확인  
   - 발주서 생성 → Supabase Storage `generated` 버킷 확인

## 🚨 **8. 문제 해결**

### 8.1 일반적인 업로드/다운로드 실패 시
1. Supabase URL과 API Key 확인
2. 버킷이 올바르게 생성되었는지 확인
3. 버킷이 Public으로 설정되었는지 확인

### 8.2 **504 Gateway Timeout 오류 (Render 배포 환경)**

이 오류는 Render와 Supabase 간의 네트워크 지연으로 인해 발생할 수 있습니다.

#### 🔧 **자동 해결 기능**
시스템에 다음과 같은 강화된 재시도 로직이 적용되어 있습니다:

- **재시도 횟수**: 최대 5번 (기존 3번에서 증가)
- **지수 백오프**: 1초 → 2초 → 4초 → 8초 → 16초 대기
- **서킷 브레이커**: 연속 실패 시 더 긴 대기
- **대체 다운로드**: Supabase API 실패 시 공개 URL 시도
- **타임아웃 제어**: 60초 업로드, 45초 다운로드 타임아웃

#### 🔍 **오류 확인 방법**
```bash
# Render 로그에서 다음과 같은 메시지 확인
❌ Supabase 다운로드 오류 (시도 1/5): StorageUnknownError: {}
🔄 2000ms 후 재시도... (연속실패: 1)
✅ Supabase 다운로드 성공 (시도 3)
```

#### 💡 **사용자 대응 방법**
1. **이메일 전송 실패 시**: 1-2분 후 다시 시도
2. **연속 실패 시**: Render 서비스 재시작
3. **지속적 문제**: Supabase 상태 페이지 확인

#### 🛠️ **추가 해결 방법**

**A) Render 서비스 재시작**
```bash
# Render 대시보드에서 "Manual Deploy" 클릭
```

**B) Supabase 프로젝트 상태 확인**
- [Supabase Status](https://status.supabase.com) 페이지 확인
- 해당 리전의 서비스 상태 확인

**C) 환경 변수 재확인**
```bash
# Render 환경 변수에서 다음 확인
SUPABASE_URL=https://your-project-id.supabase.co  # 올바른 URL
SUPABASE_ANON_KEY=eyJ...  # 올바른 anon key
```

**D) 네트워크 연결 테스트**
```bash
# 서버 시작 시 로그에서 연결 상태 확인
✅ Supabase Storage 연결 성공: uploads, mappings, generated
```

### 8.3 기타 오류

**파일 크기 초과**
- 파일 크기를 50MB 이하로 조정
- 필요시 압축 후 업로드

**권한 오류**
- 버킷 정책(RLS) 설정 확인
- Public 버킷으로 설정 확인

**메모리 부족**
- Render 플랜 업그레이드 고려
- 대용량 파일 처리 시 분할 업로드 검토

## 💰 **9. 비용 안내**

Supabase 무료 플랜:
- **Storage**: 1GB 무료
- **대역폭**: 2GB/월 무료
- **요청**: 무제한

일반적인 발주서 시스템 사용량으로는 무료 플랜으로 충분합니다. 