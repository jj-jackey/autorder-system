// 전역 변수
let currentOrderFileId = null;
let currentSupplierFileId = null;
let currentMapping = {};
let generatedFileName = null;
let displayFileName = null; // 사용자 친화적 파일명 저장
let orderFileHeaders = [];
let supplierFileHeaders = [];

// 진행 중인 요청 관리
let currentUploadController = null;
let currentProcessingController = null;
let isProcessing = false;

// 개발 환경 체크 (프로덕션에서는 로그 최소화)
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// 디버그 로그 함수 (개발 환경에서만 출력)
function debugLog(...args) {
    if (isDevelopment) {
        console.log(...args);
    }
}

// XLS 파일을 CSV로 변환하는 함수
async function convertXlsToCsv(xlsFile) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                // ArrayBuffer를 사용해서 XLS 파일 읽기
                const data = new Uint8Array(e.target.result);
                
                // XLSX 라이브러리로 워크북 읽기
                const workbook = XLSX.read(data, { 
                    type: 'array',
                    cellText: false,
                    cellNF: false,
                    cellHTML: false,
                    sheetRows: 0, // 모든 행 읽기
                    bookType: 'xls' // XLS 형식으로 명시
                });
                
                // 첫 번째 시트 가져오기
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // 시트를 CSV 형식으로 변환
                const csvData = XLSX.utils.sheet_to_csv(worksheet, {
                    FS: ',', // 필드 구분자
                    RS: '\n', // 행 구분자
                    blankrows: false, // 빈 행 제외
                    skipHidden: false,
                    strip: false,
                    rawNumbers: false // 숫자도 문자열로 처리
                });
                
                // 변환된 CSV를 File 객체로 생성
                const originalName = xlsFile.name;
                const csvFileName = originalName.replace(/\.xls$/i, '.csv');
                
                const csvBlob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
                const csvFile = new File([csvBlob], csvFileName, { 
                    type: 'text/csv',
                    lastModified: new Date().getTime() 
                });
                
                resolve(csvFile);
                
            } catch (error) {
                console.error('XLS 파일 변환 실패:', error);
                reject(new Error(`XLS 파일 변환 실패: ${error.message}`));
            }
        };
        
        reader.onerror = function() {
            console.error('❌ 파일 읽기 실패');
            reject(new Error('파일을 읽을 수 없습니다'));
        };
        
        // ArrayBuffer로 파일 읽기 시작
        reader.readAsArrayBuffer(xlsFile);
    });
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async function() {
    // 🔐 인증 상태 확인 (API 키 없이도 사용 가능)
    await checkAuthenticationStatus();
    
    initializeApp();
    loadEmailHistory();
    updateDashboard();
    
    // 초기 상태 설정
    currentMapping = {};
    generatedFileName = null;
    displayFileName = null;
    resetAllSteps();
    
    // 매핑 상태 초기화
    sessionStorage.setItem('mappingSaved', 'false');
    
    // GENERATE ORDER 버튼 초기 비활성화
    setTimeout(() => {
        updateGenerateOrderButton();
    }, 100);
    
    // 진행률 초기 숨김
    hideProgress();
});

// 앱 초기화
function initializeApp() {
    console.log('🔧 앱 초기화 시작...');
    
    setupFileUploadEvents();
    
    console.log('✅ 앱 초기화 완료');
}

// 파일 업로드 이벤트 설정
function setupFileUploadEvents() {
    // 주문서 파일 업로드
    const uploadAreaOrder = document.getElementById('uploadAreaOrder');
    const fileInputOrder = document.getElementById('fileInputOrder');
    
    if (uploadAreaOrder && fileInputOrder) {
        // 기존 이벤트 리스너 정리 (중복 방지)
        uploadAreaOrder.onclick = null;
        uploadAreaOrder.ondragover = null;
        uploadAreaOrder.ondragleave = null;
        uploadAreaOrder.ondrop = null;
        fileInputOrder.onchange = null;
        
        // 새로운 클릭 핸들러 생성 (한 번만 실행되도록)
        const clickHandlerOrder = function(e) {
            // 이미 처리 중이면 무시
            if (isProcessing) {
                return;
            }
            
            try {
                // 방법 1: 임시로 보이게 만들고 클릭
                const originalStyle = {
                    position: fileInputOrder.style.position,
                    opacity: fileInputOrder.style.opacity,
                    zIndex: fileInputOrder.style.zIndex
                };
                
                // 임시로 보이게 설정
                fileInputOrder.style.position = 'static';
                fileInputOrder.style.opacity = '1';
                fileInputOrder.style.zIndex = '9999';
                
                // 클릭 시도
                fileInputOrder.click();
                
                // 즉시 다시 숨기기
                setTimeout(() => {
                    fileInputOrder.style.position = originalStyle.position || '';
                    fileInputOrder.style.opacity = originalStyle.opacity || '';
                    fileInputOrder.style.zIndex = originalStyle.zIndex || '';
                }, 10);
                
            } catch (error) {
                console.error('fileInputOrder.click() 오류:', error);
            }
        };
        
        // 파일 선택 핸들러 생성 (한 번만 실행되도록)
        const changeHandlerOrder = function(e) {
            handleFileSelect(e, 'order');
        };
        
        // 이벤트 리스너 등록
        uploadAreaOrder.onclick = clickHandlerOrder;
        uploadAreaOrder.addEventListener('dragover', handleDragOver);
        uploadAreaOrder.addEventListener('dragleave', handleDragLeave);
        uploadAreaOrder.addEventListener('drop', (e) => handleDrop(e, 'order'));
        fileInputOrder.onchange = changeHandlerOrder;
        
    } else {
        console.error('주문서 업로드 요소를 찾을 수 없습니다');
    }
    
    // 발주서 파일 업로드
    const uploadAreaSupplier = document.getElementById('uploadAreaSupplier');
    const fileInputSupplier = document.getElementById('fileInputSupplier');
    
    if (uploadAreaSupplier && fileInputSupplier) {
        // 기존 이벤트 리스너 정리 (중복 방지)
        uploadAreaSupplier.onclick = null;
        uploadAreaSupplier.ondragover = null;
        uploadAreaSupplier.ondragleave = null;
        uploadAreaSupplier.ondrop = null;
        fileInputSupplier.onchange = null;
        
        // 새로운 클릭 핸들러 생성 (한 번만 실행되도록)
        const clickHandlerSupplier = function(e) {
            // 이미 처리 중이면 무시
            if (isProcessing) {
                return;
            }
            
            try {
                // 임시로 보이게 만들고 클릭 (브라우저 보안 정책 우회)
                const originalStyle = {
                    position: fileInputSupplier.style.position,
                    opacity: fileInputSupplier.style.opacity,
                    zIndex: fileInputSupplier.style.zIndex
                };
                
                // 임시로 보이게 설정
                fileInputSupplier.style.position = 'static';
                fileInputSupplier.style.opacity = '1';
                fileInputSupplier.style.zIndex = '9999';
                
                // 클릭 시도
                fileInputSupplier.click();
                
                // 즉시 다시 숨기기
                setTimeout(() => {
                    fileInputSupplier.style.position = originalStyle.position || '';
                    fileInputSupplier.style.opacity = originalStyle.opacity || '';
                    fileInputSupplier.style.zIndex = originalStyle.zIndex || '';
                }, 10);
                
            } catch (error) {
                console.error('fileInputSupplier.click() 오류:', error);
            }
        };
        
        // 파일 선택 핸들러 생성 (한 번만 실행되도록)
        const changeHandlerSupplier = function(e) {
            handleFileSelect(e, 'supplier');
        };
        
        // 이벤트 리스너 등록
        uploadAreaSupplier.onclick = clickHandlerSupplier;
        uploadAreaSupplier.addEventListener('dragover', handleDragOver);
        uploadAreaSupplier.addEventListener('dragleave', handleDragLeave);
        uploadAreaSupplier.addEventListener('drop', (e) => handleDrop(e, 'supplier'));
        fileInputSupplier.onchange = changeHandlerSupplier;
        
    } else {
        console.error('발주서 업로드 요소를 찾을 수 없습니다');
    }
    
    // 전송 옵션 변경 이벤트
    document.querySelectorAll('input[name="sendOption"]').forEach(radio => {
        radio.addEventListener('change', function() {
            const scheduleTimeGroup = document.getElementById('scheduleTimeGroup');
            if (this.value === 'scheduled') {
                scheduleTimeGroup.style.display = 'block';
                // 예약 시간을 현재 시간 + 1시간으로 기본 설정
                const now = new Date();
                now.setHours(now.getHours() + 1);
                const scheduleInput = document.getElementById('scheduleTime');
                scheduleInput.value = now.toISOString().slice(0, 16);
            } else {
                scheduleTimeGroup.style.display = 'none';
            }
        });
    });
    
    // 작업 모드 변경 이벤트 리스너 추가
    document.querySelectorAll('input[name="workMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            changeWorkMode(this.value);
        });
    });
    
    // 초기 모드 설정 (파일 업로드 모드)
    changeWorkMode('fileUpload');
}



// 드래그 오버 처리
function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

// 드래그 떠남 처리
function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

// 드롭 처리
function handleDrop(e, type) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0], type);
    }
}

// 파일 선택 처리
function handleFileSelect(e, type) {
    const file = e.target.files[0];
    if (file) {
        // 중복 처리 방지
        if (isProcessing) {
            // input value 초기화
            e.target.value = '';
            return;
        }
        
        // 파일 처리 시작 전에 input value 초기화 (브라우저 이슈 방지)
        const inputValue = e.target.value;
        e.target.value = '';
        
        processFile(file, type).then(() => {
            // 파일 처리 완료
        }).catch((error) => {
            console.error('파일 처리 오류:', error);
            // 오류 발생 시에도 input 초기화
        });
    }
}

// 파일이 매우 구형 BIFF 포맷인지 확인하는 함수 (Excel 2016+ 호환)
async function checkIfBinaryXLS(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const arrayBuffer = e.target.result;
            const bytes = new Uint8Array(arrayBuffer);
            

            
            // 1. ZIP 형식 확인 (OOXML, BIFF12 등)
            if (bytes.length >= 4) {
                const isZIP = bytes[0] === 0x50 && bytes[1] === 0x4B &&
                             (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
                             (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
                
                if (isZIP) {
                    console.log('✅ ZIP 기반 Excel 파일 감지 (OOXML/BIFF12):', file.name);
                    resolve(false); // ZIP 형식이면 OOXML 또는 BIFF12 (허용)
                    return;
                }
            }
            
            // 2. 매우 구형인 BIFF 시그니처만 확인 (Excel 2016+ 호환)
            if (bytes.length >= 4) {
                // BIFF2: 0x0009, BIFF3: 0x0209, BIFF4: 0x0409, BIFF5: 0x0805
                // BIFF8: 0x0809 (Excel 97-2003)는 현대 Excel에서도 사용 가능하므로 제외
                const biffSignature = (bytes[1] << 8) | bytes[0]; // Little-endian
                const biffVersion = (bytes[3] << 8) | bytes[2];
                
                // 매우 구형인 BIFF2-BIFF5만 차단 (BIFF8은 Excel 2016+ 호환)
                if (biffSignature === 0x0009 || biffSignature === 0x0209 || 
                    biffSignature === 0x0409 || biffSignature === 0x0805) {
                    console.log('❌ 매우 구형 BIFF 시그니처 감지:', file.name, 'Signature:', biffSignature.toString(16));
                    resolve(true); // 매우 구형 BIFF 형식 (차단)
                    return;
                }
            }
            
            // OLE2 구조 감지
            if (bytes.length >= 8) {
                const isOLE2 = bytes[0] === 0xD0 && bytes[1] === 0xCF && 
                              bytes[2] === 0x11 && bytes[3] === 0xE0 &&
                              bytes[4] === 0xA1 && bytes[5] === 0xB1 &&
                              bytes[6] === 0x1A && bytes[7] === 0xE1;
                
                if (isOLE2) {
                    console.log('🔍 OLE2 구조 감지:', file.name);
                    
                    // .xls 확장자인 경우 경고 표시 (하지만 차단하지는 않음)
                    if (file.name.toLowerCase().endsWith('.xls')) {
                        console.log('⚠️ .xls 파일 감지 - 호환성 경고 필요');
                        // 경고는 하되 업로드는 허용 (사용자 선택권 제공)
                    }
                    
                    console.log('✅ OLE2 구조 감지 - 처리 허용');
                    resolve(false); // 허용하되 서버에서 적절히 처리
                    return;
                }
            }
            
            // 4. CSV 파일 확인
            if (bytes.length >= 3) {
                // UTF-8 BOM 확인
                const hasUTF8BOM = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
                
                // 텍스트 파일인지 확인 (처음 100바이트가 모두 ASCII/UTF-8 범위인지)
                let isTextFile = true;
                const checkLength = Math.min(100, bytes.length);
                for (let i = hasUTF8BOM ? 3 : 0; i < checkLength; i++) {
                    const byte = bytes[i];
                    // 일반적인 텍스트 문자 범위 (개행, 탭, 출력 가능한 ASCII)
                    if (!(byte >= 0x20 && byte <= 0x7E) && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
                        isTextFile = false;
                        break;
                    }
                }
                
                if (isTextFile || hasUTF8BOM) {
                    console.log('✅ 텍스트/CSV 파일 감지:', file.name);
                    resolve(false);
                    return;
                }
            }
            
            // 5. 알 수 없는 형식은 안전하게 허용
            console.log('⚠️ 알 수 없는 파일 형식 (허용):', file.name);
            resolve(false);
        };
        
        reader.onerror = function() {
            console.error('파일 읽기 오류:', file.name);
            resolve(false); // 읽기 오류 시 안전하게 허용
        };
        
        // 파일의 첫 1024바이트만 읽어서 헤더 확인
        const blob = file.slice(0, 1024);
        reader.readAsArrayBuffer(blob);
    });
}

// 파일 처리
async function processFile(file, type) {
    // 새로운 모드별 처리가 있는 경우 해당 함수 호출
    if (type === 'supplier-direct' || type === 'template-mode') {
        return await processFileForMode(file, type);
    }
    // 파일 형식 검증 - 매우 구형 BIFF 포맷만 차단 (Excel 2016+ 호환)
    const isBiffBlocked = await checkIfBinaryXLS(file);
    if (isBiffBlocked) {
        showUploadResult(null, type, true, 
            '❌ 매우 구형 BIFF 포맷 Excel 파일은 지원되지 않습니다.<br><br>' +
            '📋 <strong>해결 방법:</strong><br>' +
            '1. Excel에서 해당 파일을 열어주세요<br>' +
            '2. "파일 → 다른 이름으로 저장" 메뉴를 선택하세요<br>' +
            '3. 파일 형식을 <strong>"Excel 통합 문서(*.xlsx)"</strong>로 변경하세요<br>' +
            '4. 변환된 .xlsx 파일을 다시 업로드해주세요<br><br>' +
            '💡 Excel 2016+ 에서 저장한 파일은 정상적으로 업로드됩니다.'
        );
        return;
    }
    
    // 허용되는 파일 형식 검증 (Excel, CSV 허용)
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const hasValidExtension = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    
    if (!hasValidExtension) {
        showUploadResult(null, type, true, 
            '❌ 지원하지 않는 파일 형식입니다.<br><br>' +
            '📋 <strong>지원 형식:</strong><br>' +
            '• Excel 파일(.xlsx, .xls) - Excel 2016+ 호환<br>' +
            '• CSV 파일(.csv)<br><br>' +
            '💡 매우 구형 BIFF 포맷 파일은 .xlsx로 변환 후 업로드해주세요.'
        );
        return;
    }
    
    // 파일 크기 검증 (10MB)
    if (file.size > 10 * 1024 * 1024) {
        showAlert('error', '파일 크기가 너무 큽니다. 10MB 이하의 파일을 업로드해주세요.');
        return;
    }
    
    // .xls 파일 자동 변환 처리
    if (file.name.toLowerCase().endsWith('.xls')) {
        showUploadWarning(type, 
            '🔄 구형 Excel 파일(.xls)을 호환 형식으로 자동 변환 중입니다...<br><br>' +
            '💡 <strong>자동 처리:</strong><br>' +
            '• XLS 파일을 CSV 형식으로 변환합니다<br>' +
            '• 변환 후 자동으로 업로드를 진행합니다<br>' +
            '• 잠시만 기다려주세요...'
        );
        
        try {
            // XLS 파일을 CSV로 자동 변환
            const convertedFile = await convertXlsToCsv(file);
            file = convertedFile; // 변환된 CSV 파일로 교체
            
            showUploadWarning(type, 
                '✅ XLS 파일이 CSV로 성공적으로 변환되었습니다!<br><br>' +
                '🔄 변환된 파일을 업로드 중입니다...'
            );
        } catch (convertError) {
            console.error('XLS 변환 실패:', convertError);
            showUploadResult(null, type, true, 
                '❌ XLS 파일 변환에 실패했습니다.<br><br>' +
                '💡 <strong>해결 방법:</strong><br>' +
                '1. Excel에서 파일을 열고 "다른 이름으로 저장" 선택<br>' +
                '2. 파일 형식을 "Excel 통합 문서(.xlsx)" 또는 "CSV(.csv)"로 변경<br>' +
                '3. 변환된 파일을 다시 업로드해주세요<br><br>' +
                `상세 오류: ${convertError.message}`
            );
            return;
        }
    }
    
    try {
        // 이미 처리 중인 경우 중단
        if (isProcessing) {
            showUploadResult(null, type, true, 
                '⚠️ 이미 파일 처리가 진행 중입니다.<br><br>' +
                '💡 현재 다른 파일을 처리하고 있습니다. 잠시 후 다시 시도해주세요.'
            );
            return;
        }
        
        // 🔄 새 파일 업로드 시 해당 파일 타입만 초기화
        console.log(`🔄 ${type} 파일 업로드로 인한 상태 초기화 시작`);
        
        // 해당 파일 타입의 이전 데이터만 초기화 (다른 파일은 유지)
        if (type === 'order') {
            currentOrderFileId = null;
            orderFileHeaders = [];
        } else {
            currentSupplierFileId = null;
            supplierFileHeaders = [];
        }
        
        // 매핑 관련 상태만 초기화 (파일 변경 시 매핑 다시 설정 필요)
        currentMapping = {};
        sessionStorage.setItem('mappingSaved', 'false');
        
        // 직접 입력 모드 해제
        window.isDirectInputMode = false;
        window.directInputData = null;
        
        // UI 상태 초기화 - STEP 2, 3, 4 숨기기 (매핑을 다시 해야 하므로)
        document.getElementById('step2').classList.add('hidden');
        document.getElementById('step3').classList.add('hidden');
        document.getElementById('step4').classList.add('hidden');
        
        // 매핑 관련 컨테이너 초기화
        const sourceFields = document.getElementById('sourceFields');
        const targetFields = document.getElementById('targetFields');
        if (sourceFields) sourceFields.innerHTML = '';
        if (targetFields) {
            targetFields.querySelectorAll('.field-item').forEach(field => {
                field.style.background = '';
                field.style.color = '';
                field.classList.remove('selected');
                field.innerHTML = field.dataset.target;
            });
        }
        
        // 필수 필드 입력 폼 숨기기
        const missingFieldsForm = document.getElementById('missingFieldsForm');
        if (missingFieldsForm) {
            missingFieldsForm.classList.add('hidden');
        }
        
        // ⚠️ 다른 파일 타입의 업로드 결과는 유지 (삭제하지 않음)
        // 각 파일은 독립적으로 관리되어야 함
        
        console.log(`✅ ${type} 파일 업로드로 인한 상태 초기화 완료 (다른 파일 타입 유지)`);
        
        // 처리 상태 설정
        isProcessing = true;
        
        // 이전 요청이 있으면 정리하고 잠시 대기
        if (currentUploadController) {
            currentUploadController.abort();
            currentUploadController = null;
            // 이전 요청 정리 대기
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 새 AbortController 생성
        currentUploadController = new AbortController();
        
        // 진행율 표시 시작
        showProgress(`${type === 'order' ? '주문서' : '발주서'} 파일을 업로드하고 있습니다...`);
        
        // 진행율 단계 정의
        const progressSteps = [
            { percent: 20, message: '파일 검증 중...' },
            { percent: 40, message: '파일 업로드 중...' },
            { percent: 60, message: '데이터 분석 중...' },
            { percent: 80, message: '헤더 추출 중...' },
            { percent: 100, message: '업로드 완료!' }
        ];
        
        const formData = new FormData();
        formData.append('orderFile', file);
        formData.append('fileType', type);
        
        // 진행율 시뮬레이션과 실제 업로드를 병렬로 실행
        const progressPromise = simulateProgress(progressSteps, 2000);
        
        const uploadPromise = fetch('/api/orders/upload', {
            method: 'POST',
            body: formData,
            signal: currentUploadController.signal
        });
        
        // 45초 타임아웃 설정 (render 환경 최적화)
        const timeoutId = setTimeout(() => {
            if (currentUploadController && !currentUploadController.signal.aborted) {
                currentUploadController.abort();
                showAlert('error', '업로드 시간이 초과되었습니다. render 서버 처리 지연이 발생할 수 있습니다. 잠시 후 다시 시도해주세요.');
            }
        }, 45000);
        
        // 진행률과 실제 업로드 모두 완료될 때까지 대기
        const [_, response] = await Promise.all([progressPromise, uploadPromise]);
        
        // 타임아웃 정리
        clearTimeout(timeoutId);
        
        const result = await response.json();
        
        hideProgress();
        
        if (result.success) {
            // 파일 타입에 따라 저장
            if (type === 'order') {
                currentOrderFileId = result.fileId;
                orderFileHeaders = result.headers;
            } else {
                currentSupplierFileId = result.fileId;
                supplierFileHeaders = result.headers;
            }
            
            // 먼저 업로드 결과를 표시
            showUploadResult(result, type);
            
            // 발주서가 업로드되었을 때 다음 단계로 이동하는 조건 개선
            if (type === 'supplier') {
                // 발주서만 업로드된 경우 - 직접 입력 모드로 안내
                if (!currentOrderFileId) {
                    showAlert('info', '📝 발주서가 업로드되었습니다. 주문서를 업로드하거나 하단의 "직접 입력" 섹션을 이용해 주문 정보를 입력하세요.');
                    
                    // 발주서만 업로드된 상태에서 주문서 업로드 안내 표시
                    const orderAlert = document.getElementById('uploadAlertOrder');
                    if (orderAlert && !orderAlert.innerHTML.includes('주문서를 업로드하거나')) {
                        orderAlert.innerHTML = '<div class="alert alert-info"><i class="fas fa-info-circle"></i> 주문서를 업로드하거나 하단 직접 입력 섹션을 이용하세요.</div>';
                    }
                } else {
                    // 두 파일 모두 업로드된 경우만 STEP 2로 이동
                    setTimeout(() => {
                        showStep(2);
                        setupMapping();
                    }, 1000);
                }
            } else if (type === 'order' && currentSupplierFileId) {
                // 주문서가 업로드되고 발주서도 이미 있는 경우 STEP 2로 이동
                setTimeout(() => {
                    showStep(2);
                    setupMapping();
                }, 1000);
            }
            
            updateUploadStatusAndButtons();
            
        } else {
            console.error('서버 응답 오류:', result);
            
            // 서버에서 보낸 구체적인 오류 메시지 처리
            let errorMessage = result.error || '파일 업로드 중 오류가 발생했습니다.';
            
            // .xls 파일 관련 오류인 경우 친화적인 메시지로 변경
            if (errorMessage.includes('Can\'t find end of central directory') || 
                errorMessage.includes('ZIP') || 
                errorMessage.includes('BIFF') ||
                file.name.toLowerCase().endsWith('.xls')) {
                errorMessage = '❌ 구형 Excel 파일(.xls)은 지원에 제한이 있습니다.<br><br>' +
                            '📋 <strong>해결 방법:</strong><br>' +
                            '1. Excel에서 해당 파일을 열어주세요<br>' +
                            '2. "파일 → 다른 이름으로 저장" 메뉴를 선택하세요<br>' +
                            '3. 파일 형식을 <strong>"Excel 통합 문서(*.xlsx)"</strong>로 변경하세요<br>' +
                            '4. 변환된 .xlsx 파일을 다시 업로드해주세요<br><br>' +
                            '💡 최신 Excel 형식(.xlsx)을 사용하시면 안정적으로 업로드됩니다.';
            }
            
            // 해당 업로드 영역에 오류 메시지 표시
            showUploadResult(null, type, true, errorMessage);
        }
        
        // 처리 완료 후 상태 초기화
        isProcessing = false;
        currentUploadController = null;
        
    } catch (error) {
        hideProgress();
        console.error('업로드 오류:', error);
        
        // 타임아웃 정리 (존재하는 경우)
        if (typeof timeoutId !== 'undefined') {
            clearTimeout(timeoutId);
        }
        
        // 처리 상태 초기화
        isProcessing = false;
        currentUploadController = null;
        
        // 요청 취소 오류인 경우 조용히 처리 (사용자에게 알리지 않음)
        if (error.name === 'AbortError') {
            console.log('업로드 요청이 취소되었습니다.');
            // AbortError는 의도적인 취소이므로 별도 알림 없이 조용히 처리
            return;
        }
        
        // catch 블록의 오류도 해당 업로드 영역에 표시
        showUploadResult(null, type, true, '파일 업로드 중 오류가 발생했습니다.');
    }
}

// 업로드 결과 표시 (성공 및 실패 케이스 모두 처리)
function showUploadResult(result, type, isError = false, errorMessage = '') {
    const uploadResultId = type === 'order' ? 'uploadResultOrder' : 'uploadResultSupplier';
    const uploadAlertId = type === 'order' ? 'uploadAlertOrder' : 'uploadAlertSupplier';
    
    const uploadResult = document.getElementById(uploadResultId);
    const uploadAlert = document.getElementById(uploadAlertId);
    
    // 요소가 존재하지 않으면 기본 알림으로 대체
    if (!uploadResult || !uploadAlert) {
        const fileTypeText = type === 'order' ? '주문서' : '발주서';
        if (isError) {
            showAlert('error', `❌ ${fileTypeText} 파일 업로드 실패: ${errorMessage}`);
        } else {
            showAlert('success', `✅ ${fileTypeText} 파일이 성공적으로 업로드되었습니다! (${result.headers.length}개 필드)`);
        }
        return;
    }
    
    uploadResult.classList.remove('hidden');
    uploadResult.classList.add('upload-result');
    
    const fileTypeText = type === 'order' ? '주문서' : '발주서';
    
    // 오류 케이스 처리
    if (isError) {
        // 실패한 파일의 상태 초기화
        if (type === 'order') {
            currentOrderFileId = null;
            orderFileHeaders = [];
        } else {
            currentSupplierFileId = null;
            supplierFileHeaders = [];
        }
        
        // STEP 2 숨기기 (두 파일이 모두 업로드되지 않았으므로)
        if (!currentOrderFileId || !currentSupplierFileId) {
            showStep(1);
            
            // 매핑 관련 상태 초기화
            currentMapping = {};
            
            // STEP 2 UI 완전히 초기화
            const step2 = document.getElementById('step2');
            if (step2) {
                step2.classList.add('hidden');
            }
            
            // 매핑 관련 컨테이너 초기화
            const sourceFieldsContainer = document.getElementById('sourceFields');
            const targetFieldsContainer = document.getElementById('targetFields');
            if (sourceFieldsContainer) sourceFieldsContainer.innerHTML = '';
            if (targetFieldsContainer) {
                const targetFields = targetFieldsContainer.querySelectorAll('.field-item');
                targetFields.forEach(field => {
                    field.style.background = '';
                    field.style.color = '';
                    field.innerHTML = field.dataset.target;
                });
            }
        }
        
        // 업로드 상태 및 버튼 업데이트
        updateUploadStatusAndButtons();
        
        uploadAlert.innerHTML = `
            <div class="alert alert-error">
                ❌ ${fileTypeText} 파일 업로드 실패<br>
                <strong>오류:</strong> ${errorMessage}
                <div style="margin-top: 10px; padding: 8px; background-color: #f8f9fa; border-left: 4px solid #17a2b8; border-radius: 4px;">
                    💡 위의 ${fileTypeText} 업로드 영역에서 다른 파일을 선택해주세요.
                </div>
            </div>
        `;
        return;
    }
    
    // 성공 케이스 처리
    // 빈 템플릿 경고 확인
    const emptyTemplateWarning = result.validation.warnings.find(w => w.type === 'empty_template');
    
    if (result.validation.isValid) {
        uploadAlert.innerHTML = `
            <div class="alert alert-success">
                ✅ ${fileTypeText} 파일 업로드 성공<br>
                <strong>파일명:</strong> ${result.fileName}<br>
                <strong>검증 결과:</strong> ${result.validation.validRows}/${result.validation.totalRows}행 처리 가능 
                (성공률: ${result.validation.summary.successRate}%)<br>
                <strong>필드 수:</strong> ${result.headers.length}개
                <div style="margin-top: 10px; padding: 8px; background-color: #f8f9fa; border-left: 4px solid #28a745; border-radius: 4px;">
                    💡 다른 ${fileTypeText} 파일로 변경하려면 위의 업로드 영역을 이용해주세요.
                </div>
            </div>
        `;
    } else {
        const validationMessages = result.validation.errors.map(error => `• ${error.message}`).join('<br>');
        uploadAlert.innerHTML = `
            <div class="alert alert-warning">
                ⚠️ ${fileTypeText} 파일 업로드 완료 (일부 문제 있음)<br>
                <strong>파일명:</strong> ${result.fileName}<br>
                <strong>검증 결과:</strong> ${result.validation.validRows}/${result.validation.totalRows}행 처리 가능<br>
                <strong>문제점:</strong><br>${validationMessages}
                <div style="margin-top: 10px; padding: 8px; background-color: #f8f9fa; border-left: 4px solid #ffc107; border-radius: 4px;">
                    💡 다른 ${fileTypeText} 파일로 변경하려면 위의 업로드 영역을 이용해주세요.
                </div>
            </div>
        `;
    }
    
    // 빈 템플릿 경고가 있으면 추가 안내
    if (emptyTemplateWarning) {
        const existingAlert = uploadAlert.querySelector('.alert');
        if (existingAlert) {
            existingAlert.innerHTML += `
                <div style="margin-top: 10px; padding: 10px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px;">
                    <strong>💡 템플릿 안내:</strong><br>
                    ${emptyTemplateWarning.message}
                </div>
            `;
        }
    }
    
    // 업로드 상태에 따른 안내 메시지 및 버튼 가시성 제어
    updateUploadStatusAndButtons();
    
    // 두 파일이 모두 업로드되었을 때 안내 메시지 추가 (성공 케이스에서만)
    if (!isError && currentOrderFileId && currentSupplierFileId) {
        // 양쪽 모두에 완료 메시지 추가
        const completeMessage = `
            <div class="alert alert-info" style="margin-top: 10px;">
                🎉 두 파일이 모두 업로드되었습니다. 필드 매핑을 설정해주세요.
            </div>
        `;
        
        const orderAlert = document.getElementById('uploadAlertOrder');
        const supplierAlert = document.getElementById('uploadAlertSupplier');
        
        if (orderAlert && !orderAlert.innerHTML.includes('두 파일이 모두 업로드되었습니다')) {
            orderAlert.innerHTML += completeMessage;
        }
        if (supplierAlert && !supplierAlert.innerHTML.includes('두 파일이 모두 업로드되었습니다')) {
            supplierAlert.innerHTML += completeMessage;
        }
    } else if (!isError && !currentOrderFileId && currentSupplierFileId) {
        // 발주서만 업로드된 경우 - 주문서 업로드 영역에 안내 메시지 표시
        const orderAlert = document.getElementById('uploadAlertOrder');
        if (orderAlert && !orderAlert.innerHTML.includes('주문서를 업로드하거나')) {
            orderAlert.innerHTML = `
                <div class="alert alert-info">
                    📝 주문서를 업로드하거나 아래 "직접 입력하기"를 이용해주세요.
                </div>
            `;
            
            // 주문서 업로드 결과 영역 표시
            const orderResult = document.getElementById('uploadResultOrder');
            if (orderResult) {
                orderResult.classList.remove('hidden');
            }
        }
        
        // 발주서 업로드 완료 시 추가 안내 메시지
        if (type === 'supplier') {
            const supplierAlert = document.getElementById('uploadAlertSupplier');
            if (supplierAlert && !supplierAlert.innerHTML.includes('다음 단계를 진행하려면')) {
                supplierAlert.innerHTML += `
                    <div class="alert alert-warning" style="margin-top: 10px;">
                        ⚠️ 다음 단계를 진행하려면 주문서를 업로드하거나 "직접 입력하기"를 이용해주세요.
                    </div>
                `;
            }
        }
    }
}

// 매핑 설정
function setupMapping() {
    console.log('🔧 setupMapping 함수 시작');
    
    // 두 파일이 모두 업로드되었는지 확인
    if (!currentOrderFileId) {
        console.warn('⚠️ 주문서 파일이 업로드되지 않았습니다.');
        showAlert('warning', '주문서 파일을 먼저 업로드해주세요.');
        return;
    }
    
    if (!currentSupplierFileId) {
        console.warn('⚠️ 발주서 파일이 업로드되지 않았습니다.');
        showAlert('warning', '발주서 파일을 먼저 업로드해주세요.');
        return;
    }
    
    try {
        // 소스 필드 초기화 - 주문서 필드만
        const sourceFieldsContainer = document.getElementById('sourceFields');
        if (!sourceFieldsContainer) {
            throw new Error('sourceFields 요소를 찾을 수 없습니다.');
        }
        sourceFieldsContainer.innerHTML = '';
        
        // 주문서 필드 추가
        console.log('📋 주문서 헤더 처리:', orderFileHeaders);
        if (orderFileHeaders.length > 0) {
            orderFileHeaders.forEach(header => {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'field-item';
                fieldDiv.textContent = header;
                fieldDiv.dataset.source = header;
                fieldDiv.dataset.fileType = 'order';
                fieldDiv.onclick = () => selectSourceField(fieldDiv);
                sourceFieldsContainer.appendChild(fieldDiv);
            });
            console.log('✅ 주문서 필드 추가 완료:', orderFileHeaders.length, '개');
        } else {
            console.warn('⚠️ 주문서 헤더가 비어있습니다.');
        }
        
        // 타겟 필드 초기화 - 발주서 필드 또는 기본 템플릿
        const targetFieldsContainer = document.getElementById('targetFields');
        if (!targetFieldsContainer) {
            throw new Error('targetFields 요소를 찾을 수 없습니다.');
        }
        targetFieldsContainer.innerHTML = '';
        
        // 발주서 필드 추가 또는 기본 템플릿 사용
        console.log('📋 발주서 헤더 처리:', supplierFileHeaders);
        if (supplierFileHeaders.length > 0) {
            // 발주서 파일이 업로드된 경우
            supplierFileHeaders.forEach(header => {
                const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field-item';
            fieldDiv.textContent = header;
            fieldDiv.dataset.target = header;
            fieldDiv.dataset.fileType = 'supplier';
            fieldDiv.onclick = () => selectTargetField(fieldDiv);
            targetFieldsContainer.appendChild(fieldDiv);
        });
    } else {
        // 발주서 파일이 없는 경우 기본 템플릿 사용
        const defaultTemplate = getDefaultSupplierTemplate();
        defaultTemplate.forEach(field => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field-item';
            fieldDiv.textContent = field;
            fieldDiv.dataset.target = field;
            fieldDiv.dataset.fileType = 'default';
            fieldDiv.onclick = () => selectTargetField(fieldDiv);
            targetFieldsContainer.appendChild(fieldDiv);
        });
        
        // 기본 템플릿 사용 안내
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = `
            background: #e3f2fd;
            color: #1976d2;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 10px;
            font-size: 0.9em;
            text-align: center;
        `;
        infoDiv.innerHTML = '📋 기본 발주서 템플릿을 사용합니다';
        targetFieldsContainer.insertBefore(infoDiv, targetFieldsContainer.firstChild);
    }
    
    // 타겟 필드 초기화 (이전 매핑 상태 제거)
    resetTargetFields();
    
    // 타겟 필드 클릭 이벤트
    document.querySelectorAll('#targetFields .field-item').forEach(item => {
        item.onclick = () => selectTargetField(item);
    });
    
        // 매핑 상태 초기화
        sessionStorage.setItem('mappingSaved', 'false');
        
        // GENERATE ORDER 버튼 초기 비활성화
        updateGenerateOrderButton();
        
        // 자동 매핑 실행
        console.log('🔄 자동 매핑 시작...');
        performAutoMatching();
        
            console.log('✅ setupMapping 함수 완료');
    } catch (error) {
        console.error('❌ setupMapping 함수 오류:', error);
        showAlert('error', '매핑 설정 중 오류가 발생했습니다: ' + error.message);
    }
}

// 업로드 영역에 경고 메시지 표시
function showUploadWarning(type, message) {
    const uploadResultId = type === 'order' ? 'uploadResultOrder' : 'uploadResultSupplier';
    const uploadAlertId = type === 'order' ? 'uploadAlertOrder' : 'uploadAlertSupplier';
    
    const uploadResult = document.getElementById(uploadResultId);
    const uploadAlert = document.getElementById(uploadAlertId);
    
    const fileTypeText = type === 'order' ? '주문서' : '발주서';
    
    if (uploadResult && uploadAlert) {
        uploadResult.classList.remove('hidden');
        uploadAlert.innerHTML = `
            <div class="alert alert-warning">
                ${message}
                <div style="margin-top: 10px; padding: 8px; background-color: #f8f9fa; border-left: 4px solid #ffc107; border-radius: 4px;">
                    💡 다른 ${fileTypeText} 파일을 사용하려면 위의 업로드 영역을 이용해주세요.
                </div>
            </div>
        `;
    } else {
        // 요소가 없으면 전역 알림으로 대체
        showAlert('warning', message);
    }
}

// 업로드 상태에 따른 버튼 가시성 제어
function updateUploadStatusAndButtons() {
    const directInputButtonContainer = document.getElementById('directInputButtonContainer');
    
    if (!directInputButtonContainer) return;
    
    // 주문서 파일이 업로드되지 않은 경우에만 직접 입력 버튼 표시
    if (!currentOrderFileId) {
        directInputButtonContainer.style.display = 'block';
        
        // 발주서 파일만 업로드된 경우 버튼 텍스트 변경
        const button = directInputButtonContainer.querySelector('button');
        if (currentSupplierFileId) {
            button.innerHTML = '📝 주문서 없이 직접 입력하기 (발주서 파일 준비됨)';
            button.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
        } else {
            button.innerHTML = '📝 주문서 없이 직접 입력하기';
            button.style.background = 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)';
        }
    } else {
        directInputButtonContainer.style.display = 'none';
    }
}

// 소스 필드 선택
function selectSourceField(element) {
    document.querySelectorAll('#sourceFields .field-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');
}

// 타겟 필드 선택 및 매핑
function selectTargetField(element) {
    const targetField = element.dataset.target;
    
    // 이미 매핑된 필드인지 확인 (매핑 취소 기능)
    if (currentMapping[targetField]) {
        // 매핑 취소
        const sourceField = currentMapping[targetField];
        delete currentMapping[targetField];
        
        // 타겟 필드 원래대로 복원
        element.style.background = '';
        element.style.color = '';
        element.innerHTML = targetField;
        
        // 소스 필드를 다시 SOURCE FIELDS에 추가
        const sourceFieldsContainer = document.getElementById('sourceFields');
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'field-item';
        fieldDiv.textContent = sourceField;
        fieldDiv.dataset.source = sourceField;
        fieldDiv.onclick = () => selectSourceField(fieldDiv);
        sourceFieldsContainer.appendChild(fieldDiv);
        
        showAlert('info', `${sourceField} → ${targetField} 매핑이 취소되었습니다.`);
        
        // GENERATE ORDER 버튼 비활성화
        updateGenerateOrderButton();
        return;
    }
    
    // 새로운 매핑 생성
    const selectedSource = document.querySelector('#sourceFields .field-item.selected');
    
    if (!selectedSource) {
        showAlert('warning', '먼저 주문서 컬럼을 선택해주세요.');
        return;
    }
    
    const sourceField = selectedSource.dataset.source;
    
    // 매핑 저장
    currentMapping[targetField] = sourceField;
    
    // 시각적 표시
    element.style.background = '#28a745';
    element.style.color = 'white';
    element.innerHTML = `${targetField} ← ${sourceField}`;
    
    // 선택된 소스 필드 제거
    selectedSource.remove();
    
    showAlert('success', `${sourceField} → ${targetField} 매핑이 완료되었습니다.`);
    
    // GENERATE ORDER 버튼 상태 업데이트
    updateGenerateOrderButton();
}

// GENERATE ORDER 버튼 상태 업데이트
function updateGenerateOrderButton() {
    const generateBtn = document.querySelector('button[onclick="generateOrder()"]');
    const isMappingSaved = sessionStorage.getItem('mappingSaved') === 'true';
    
    if (isMappingSaved && Object.keys(currentMapping).length > 0) {
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
        generateBtn.style.cursor = 'pointer';
    } else {
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.5';
        generateBtn.style.cursor = 'not-allowed';
    }
}

// AI 자동 매핑
async function aiAutoMapping() {
    // OpenAI API 키 체크
    if (!window.hasOpenAIKey) {
        showAlert('warning', '🤖 AI 자동 매핑 기능을 사용하려면 OpenAI API 키가 필요합니다.\n\n💡 대신 수동으로 드래그앤드롭 매핑을 사용하거나 저장된 템플릿을 이용해보세요!');
        return;
    }
    
    const isDirectMode = window.isDirectInputMode === true;
    
    // 디버깅: 현재 상태 확인
    console.log('🤖 AI AUTO MAPPING 시작 - 새 버전');
    console.log('- orderFileHeaders.length:', orderFileHeaders.length);
    console.log('- supplierFileHeaders.length:', supplierFileHeaders.length);
    console.log('- orderFileHeaders:', orderFileHeaders);
    console.log('- supplierFileHeaders:', supplierFileHeaders);
    console.log('- isDirectMode:', isDirectMode);
    console.log('- currentMapping:', currentMapping);
    
    // 주문서 필드가 없으면 중단
    if (orderFileHeaders.length === 0) {
        showAlert('warning', '주문서 데이터가 필요합니다.');
        return;
    }
    
    // 발주서 필드가 없으면 기본 템플릿 자동 사용
    if (supplierFileHeaders.length === 0) {
        console.log('🔍 기본 템플릿 설정 전 - supplierFileHeaders.length:', supplierFileHeaders.length);
        supplierFileHeaders = getDefaultSupplierTemplate();
        console.log('📋 AI 매핑을 위한 기본 템플릿 자동 설정:', supplierFileHeaders);
        console.log('📋 설정 후 supplierFileHeaders.length:', supplierFileHeaders.length);
        
        // setupMapping 다시 호출하여 UI 업데이트
        setupMapping();
        console.log('✅ setupMapping 호출 완료');
    }
    
    try {
        const progressMessage = isDirectMode ? 
            'AI가 직접 입력 데이터와 발주서 템플릿을 분석하고 자동 매핑을 생성하고 있습니다...' :
            'AI가 필드를 분석하고 자동 매핑을 생성하고 있습니다...';
        
        showProgress(progressMessage);
        
        // 진행율 단계 정의
        const progressSteps = isDirectMode ? [
            { percent: 20, message: '직접 입력 데이터를 분석하고 있습니다...' },
            { percent: 40, message: 'AI 모델에 요청을 전송하고 있습니다...' },
            { percent: 60, message: '발주서 템플릿과 최적의 매핑을 찾고 있습니다...' },
            { percent: 80, message: '매핑 결과를 처리하고 있습니다...' },
            { percent: 100, message: '직접 입력 데이터 자동 매핑이 완료되었습니다!' }
        ] : [
            { percent: 20, message: '필드 목록을 분석하고 있습니다...' },
            { percent: 40, message: 'AI 모델에 요청을 전송하고 있습니다...' },
            { percent: 60, message: '최적의 매핑을 찾고 있습니다...' },
            { percent: 80, message: '매핑 결과를 처리하고 있습니다...' },
            { percent: 100, message: '자동 매핑이 완료되었습니다!' }
        ];
        
        const requestData = {
            orderFields: orderFileHeaders,
            supplierFields: supplierFileHeaders
        };
        
        console.log('📤 AI 매핑 API 요청:', requestData);
        
        // 진행률 시뮬레이션과 실제 API 호출을 병렬로 실행
        const progressPromise = simulateProgress(progressSteps, 3000);
        
        const mappingPromise = fetch('/api/orders/ai-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        // 진행률과 실제 매핑 모두 완료될 때까지 대기
        const [_, response] = await Promise.all([progressPromise, mappingPromise]);
        
        console.log('📥 AI 매핑 API 응답 상태:', response.status);
        
        // 인증 오류 확인
        if (response.status === 401) {
            hideProgress();
            showAlert('warning', '🔐 OpenAI API 키 인증이 필요합니다. 인증 페이지로 이동합니다.');
            setTimeout(() => {
                window.location.href = '/auth.html';
            }, 2000);
            return;
        }
        
        const result = await response.json();
        
        console.log('📥 AI 매핑 API 응답 결과:', result);
        
        hideProgress();
        
        if (result.success) {
            console.log('✅ AI 매핑 성공, 매핑 결과:', result.mappings);
            
            // AI 매핑 결과 적용 (기존 매핑에 추가)
            applyAutoMapping(result.mappings);
            
            const successMessage = isDirectMode ? 
                `✅ 직접 입력 데이터 AI 자동 매핑이 완료되었습니다! ${Object.keys(result.mappings).length}개의 필드가 매핑되었습니다.` :
                `✅ AI 자동 매핑이 완료되었습니다! ${Object.keys(result.mappings).length}개의 필드가 매핑되었습니다.`;
            
            showAlert('success', successMessage);
            
            // SAVE MAPPING 버튼 활성화 (매핑 저장 필요)
            sessionStorage.setItem('mappingSaved', 'false');
            updateGenerateOrderButton();
            
        } else {
            // 인증이 필요한 경우 처리
            if (result.requireAuth) {
                showAlert('warning', '🔐 OpenAI API 키 인증이 필요합니다. 인증 페이지로 이동합니다.');
                setTimeout(() => {
                    window.location.href = '/auth.html';
                }, 2000);
            } else {
                showAlert('error', result.error || 'AI 자동 매핑에 실패했습니다.');
            }
        }
        
    } catch (error) {
        hideProgress();
        console.error('AI 자동 매핑 오류:', error);
        
        // 401 인증 오류인 경우 처리
        if (error.status === 401 || (error.response && error.response.status === 401)) {
            showAlert('warning', '🔐 인증이 만료되었습니다. 인증 페이지로 이동합니다.');
            setTimeout(() => {
                window.location.href = '/auth.html';
            }, 2000);
        } else {
            showAlert('error', 'AI 자동 매핑 중 오류가 발생했습니다. 수동으로 매핑해주세요.');
        }
    }
}

// 매핑 상태 초기화
function resetMappingState() {
    // 기존 매핑 초기화
    currentMapping = {};
    
    // 모든 타겟 필드 초기화
    const targetFields = document.querySelectorAll('#targetFields .field-item');
    targetFields.forEach(field => {
        field.style.background = '';
        field.style.color = '';
        field.innerHTML = field.dataset.target;
    });
    
    // 소스 필드 다시 표시 (주문서 헤더가 있는 경우에만)
    const sourceFieldsContainer = document.getElementById('sourceFields');
    if (sourceFieldsContainer) {
        sourceFieldsContainer.innerHTML = '';
        
        if (orderFileHeaders && orderFileHeaders.length > 0) {
            orderFileHeaders.forEach(header => {
                const fieldDiv = document.createElement('div');
                fieldDiv.className = 'field-item';
                fieldDiv.textContent = header;
                fieldDiv.dataset.source = header;
                fieldDiv.dataset.fileType = 'order';
                fieldDiv.onclick = () => selectSourceField(fieldDiv);
                sourceFieldsContainer.appendChild(fieldDiv);
            });
        }
    }
}

// 자동 매핑 적용
function applyAutoMapping(mappings) {
    console.log('🎯 AI 매핑 적용 시작:', mappings);
    
    Object.entries(mappings).forEach(([targetField, sourceField]) => {
        // 매핑 저장
        currentMapping[targetField] = sourceField;
        
        // 타겟 필드 시각적 업데이트
        const targetElement = document.querySelector(`[data-target="${targetField}"]`);
        console.log(`🔍 타겟 필드 찾기: ${targetField}`, targetElement);
        
        if (targetElement) {
            targetElement.style.background = '#6f42c1';
            targetElement.style.color = 'white';
            targetElement.innerHTML = `${targetField} ← ${sourceField} 🤖`;
        } else {
            console.log(`❌ 타겟 필드를 찾을 수 없음: ${targetField}`);
        }
        
        // 소스 필드 제거
        const sourceElement = document.querySelector(`[data-source="${sourceField}"]`);
        console.log(`🔍 소스 필드 찾기: ${sourceField}`, sourceElement);
        
        if (sourceElement) {
            sourceElement.remove();
        } else {
            console.log(`❌ 소스 필드를 찾을 수 없음: ${sourceField}`);
        }
    });
    
    console.log('✅ AI 매핑 적용 완료. 현재 매핑:', currentMapping);
}

// 매핑 저장
async function saveMapping() {
    if (Object.keys(currentMapping).length === 0) {
        showAlert('warning', '매핑 규칙을 설정해주세요.');
        return;
    }
    
    // 매핑 검증
    const validation = validateRequiredFields(currentMapping);
    if (!validation.isValid) {
        showAlert('warning', validation.message);
        return;
    }
    
    // 매핑되지 않은 필드는 빈 값으로 처리 (자동입력 없음)
    const finalMapping = { ...currentMapping };
    const targetFields = document.querySelectorAll('#targetFields .field-item');
    
    targetFields.forEach(field => {
        const fieldName = field.dataset.target;
        if (!finalMapping[fieldName]) {
            // 매핑되지 않은 필드는 아예 포함하지 않음 (빈 값으로 처리)
            field.style.background = '#f8f9fa';
            field.style.color = '#6c757d';
            field.innerHTML = `${fieldName} (매핑 안됨)`;
        }
    });
    
    try {
        const mappingData = {
            mappingName: `mapping_${Date.now()}`,
            sourceFields: Object.values(finalMapping),
            targetFields: Object.keys(finalMapping),
            mappingRules: finalMapping
        };
        
        console.log('📤 매핑 저장 요청 전송:');
        console.log('🔗 현재 매핑:', currentMapping);
        console.log('📋 최종 매핑:', finalMapping);
        console.log('📋 전송할 데이터:', mappingData);
        
        const response = await fetch('/api/orders/mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mappingData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 전역 매핑 업데이트
            currentMapping = finalMapping;
            
            const mappedCount = Object.keys(finalMapping).length;
            const totalTargetFields = document.querySelectorAll('#targetFields .field-item').length;
            const unmappedCount = totalTargetFields - mappedCount;
            
            let message = `✅ 매핑 규칙이 저장되었습니다.`;
            if (mappedCount > 0) message += ` ${mappedCount}개 필드가 매핑되었습니다.`;
            if (unmappedCount > 0) message += ` ${unmappedCount}개 필드는 빈 값으로 처리됩니다.`;
            
            showAlert('success', message);
            
            // 매핑 저장 상태 표시 및 매핑 ID 저장
            sessionStorage.setItem('mappingSaved', 'true');
            sessionStorage.setItem('savedMappingId', mappingData.mappingName);
            
            console.log('💾 매핑 ID 저장됨:', mappingData.mappingName);
            
            // GENERATE ORDER 버튼 활성화
            updateGenerateOrderButton();
            
        } else {
            showAlert('error', result.error || '매핑 저장에 실패했습니다.');
        }
        
    } catch (error) {
        console.error('매핑 저장 오류:', error);
        showAlert('error', '매핑 저장 중 오류가 발생했습니다.');
    }
}

// 발주서 생성
async function generateOrder() {
    // 직접 입력 모드 또는 파일 업로드 모드 확인
    const isDirectMode = window.isDirectInputMode === true;
    
    if (!isDirectMode && !currentOrderFileId) {
        showAlert('error', '주문서 파일이 업로드되지 않았습니다.');
        return;
    }
    
    // 매핑이 저장되어 있는지 확인
    if (sessionStorage.getItem('mappingSaved') !== 'true') {
        showAlert('warning', '매핑을 먼저 저장해주세요.');
        return;
    }
    
    try {
        // 진행률 표시 시작
        showProgress('발주서 생성을 준비하고 있습니다...');
        
        // 진행률 단계 정의
        const progressSteps = [
            { percent: 20, message: '저장된 매핑 규칙을 불러오고 있습니다...' },
            { percent: 40, message: '파일 데이터를 읽고 있습니다...' },
            { percent: 60, message: '데이터를 변환하고 있습니다...' },
            { percent: 80, message: '발주서를 생성하고 있습니다...' },
            { percent: 100, message: '발주서 생성이 완료되었습니다!' }
        ];
        
        // 저장된 매핑 ID 가져오기 (sessionStorage에서)
        const savedMappingId = sessionStorage.getItem('savedMappingId');
        if (!savedMappingId) {
            showAlert('error', '저장된 매핑을 찾을 수 없습니다. 매핑을 다시 저장해주세요.');
            return;
        }
        
        let requestData, apiEndpoint;
        
        if (isDirectMode) {
            // 직접 입력 모드: generate-direct API 사용
            requestData = {
                mappingId: savedMappingId,
                inputData: window.directInputData,
                templateType: 'standard',
                supplierFileId: currentSupplierFileId
            };
            apiEndpoint = '/api/orders/generate-direct';
            console.log('📝 직접 입력 발주서 생성 시작');
            console.log('📊 직접 입력 데이터:', window.directInputData);
        } else {
            // 파일 업로드 모드: generate API 사용
            requestData = {
                fileId: currentOrderFileId,
                mappingId: savedMappingId,
                templateType: 'standard',
                supplierFileId: currentSupplierFileId
            };
            apiEndpoint = '/api/orders/generate';
            console.log('📋 파일 업로드 발주서 생성 시작');
            console.log('📂 파일 ID:', currentOrderFileId);
        }
        
        console.log('🗂️ 저장된 매핑 ID:', savedMappingId);
        console.log('🔗 현재 매핑 규칙:', currentMapping);
        
        // 진행률 시뮬레이션과 실제 작업을 병렬로 실행
        const progressPromise = simulateProgress(progressSteps, 2500);
        
        // 실제 API 호출 (매핑은 이미 저장되어 있으므로 바로 발주서 생성)
        const workPromise = (async () => {
            console.log('📋 발주서 생성 요청 전송');
            console.log('📤 생성 요청 데이터:', requestData);
            console.log('🔗 API 엔드포인트:', apiEndpoint);
            
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            return response.json();
        })();
        
        // 진행률과 실제 작업 모두 완료될 때까지 대기
        const [_, result] = await Promise.all([progressPromise, workPromise]);
        
        // 진행률 숨기기
        hideProgress();
        
        if (result.success) {
            generatedFileName = result.generatedFile;
            displayFileName = result.displayFileName || result.userFriendlyFileName;
            showGenerateResult(result);
            showStep(3);
            showStep(4);
        } else {
            showAlert('error', result.error || '발주서 생성에 실패했습니다.');
        }
        
    } catch (error) {
        hideProgress();
        console.error('발주서 생성 오류:', error);
        showAlert('error', '발주서 생성 중 오류가 발생했습니다.');
    }
}

// 발주서 생성 결과 표시
function showGenerateResult(result) {
    const generateResult = document.getElementById('generateResult');
    
    generateResult.innerHTML = `
        <div class="alert alert-success">
            ✅ 발주서가 성공적으로 생성되었습니다!<br>
            <strong>처리 결과:</strong> ${result.processedRows}/${result.processedRows}행 처리 완료<br>
            <strong>생성된 파일:</strong> ${result.generatedFile}
        </div>
        
        <div style="text-align: center; margin-top: 20px;">
            <a href="${result.downloadUrl}" class="btn btn-success" download>DOWNLOAD ORDER</a>
        </div>
        
        <!-- 템플릿 저장 UI -->
        <div id="templateSaveSection" style="margin-top: 30px; padding: 20px; background: linear-gradient(145deg, #e8f5e8 0%, #d4edda 100%); border-radius: 8px; border: 2px solid #28a745;">
            <h4 style="color: #155724; margin-bottom: 15px; text-align: center;">💾 이 매핑을 템플릿으로 저장하시겠습니까?</h4>
            <p style="color: #155724; text-align: center; margin-bottom: 20px;">같은 형태의 주문서를 반복적으로 처리할 때 매핑 과정을 생략할 수 있습니다.</p>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                <div>
                    <label for="templateName" style="display: block; margin-bottom: 5px; font-weight: 600; color: #155724;">템플릿명 <span style="color: #dc3545;">*</span></label>
                    <input type="text" id="templateName" placeholder="예: 식자재 주문 템플릿" style="width: 100%; padding: 8px; border: 1px solid #28a745; border-radius: 4px;">
                </div>
                <div>
                    <label for="templateDescription" style="display: block; margin-bottom: 5px; font-weight: 600; color: #155724;">설명 (선택)</label>
                    <input type="text" id="templateDescription" placeholder="템플릿 설명을 입력하세요" style="width: 100%; padding: 8px; border: 1px solid #28a745; border-radius: 4px;">
                </div>
            </div>
            
            <div style="text-align: center;">
                <button onclick="saveCurrentMappingAsTemplate()" class="btn" style="background: #28a745; color: white; margin-right: 10px;">💾 템플릿 저장</button>
                <button onclick="hideTemplateSaveSection()" class="btn" style="background: #6c757d; color: white;">나중에</button>
            </div>
            
            <div id="templateSaveResult" style="margin-top: 15px;"></div>
        </div>
    `;
    
    if (result.errors && result.errors.length > 0) {
        generateResult.innerHTML += `
            <div class="alert alert-warning" style="margin-top: 15px;">
                <strong>오류 내역:</strong><br>
                ${result.errors.map(err => `행 ${err.row}: ${err.error}`).join('<br>')}
            </div>
        `;
    }
}

// 템플릿 저장 섹션 숨기기
function hideTemplateSaveSection() {
    const templateSaveSection = document.getElementById('templateSaveSection');
    if (templateSaveSection) {
        templateSaveSection.style.display = 'none';
    }
}

// 현재 매핑을 템플릿으로 저장
async function saveCurrentMappingAsTemplate() {
    try {
        const templateName = document.getElementById('templateName').value.trim();
        const templateDescription = document.getElementById('templateDescription').value.trim();
        
        // 입력 검증
        if (!templateName) {
            showAlert('error', '템플릿명을 입력해주세요.');
            return;
        }
        
        if (!currentMapping || Object.keys(currentMapping).length === 0) {
            showAlert('error', '저장할 매핑 데이터가 없습니다.');
            return;
        }
        
        // 로딩 표시
        document.getElementById('templateSaveResult').innerHTML = `
            <div style="text-align: center; color: #155724;">
                <div style="display: inline-block; width: 20px; height: 20px; border: 2px solid #28a745; border-radius: 50%; border-top: 2px solid transparent; animation: spin 1s linear infinite; margin-right: 10px;"></div>
                템플릿을 저장하고 있습니다...
            </div>
        `;
        
        // 현재 저장된 발주서 매핑 데이터 가져오기
        const savedMappingId = sessionStorage.getItem('savedMappingId');
        let supplierFieldMapping = {};
        
        if (savedMappingId) {
            try {
                const mappingResponse = await fetch(`/api/orders/mapping/${savedMappingId}`);
                const mappingResult = await mappingResponse.json();
                
                if (mappingResult.success && mappingResult.supplierMapping) {
                    supplierFieldMapping = mappingResult.supplierMapping;
                }
            } catch (error) {
                console.warn('발주서 매핑 정보를 가져오는데 실패했습니다:', error);
            }
        }
        
        // supplierFieldMapping이 비어있으면 현재 UI의 타겟 필드에서 생성
        if (!supplierFieldMapping || Object.keys(supplierFieldMapping).length === 0) {
            console.log('⚠️ 저장된 발주서 매핑이 없어 현재 UI에서 생성');
            
            // 현재 매핑된 타겟 필드들로 기본 매핑 생성
            const targetFields = document.querySelectorAll('#targetFields .field-item');
            targetFields.forEach(field => {
                const fieldName = field.dataset.target;
                if (fieldName) {
                    supplierFieldMapping[fieldName] = fieldName; // 기본적으로 같은 이름으로 매핑
                }
            });
            
            console.log('🔄 생성된 기본 발주서 매핑:', supplierFieldMapping);
        }
        
        // 템플릿 저장 전 최종 검증
        if (!supplierFieldMapping || Object.keys(supplierFieldMapping).length === 0) {
            showAlert('error', '발주서 필드 매핑이 없습니다. 템플릿을 저장하려면 발주서 필드가 필요합니다.');
            document.getElementById('templateSaveResult').innerHTML = '';
            return;
        }
        
        // 템플릿 저장 요청
        const templateData = {
            templateName: templateName,
            description: templateDescription,
            orderFieldMapping: currentMapping,
            supplierFieldMapping: supplierFieldMapping,
            fixedFields: {},
            createdBy: 'anonymous' // 향후 사용자 시스템과 연동 시 실제 사용자명 사용
        };
        
        console.log('💾 템플릿 저장 요청:', templateData);
        
        const response = await fetch('/api/templates', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(templateData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 성공 메시지 표시
            document.getElementById('templateSaveResult').innerHTML = `
                <div style="background: #d1f2d1; color: #155724; padding: 10px; border-radius: 4px; text-align: center;">
                    ✅ 템플릿이 성공적으로 저장되었습니다!<br>
                    <strong>템플릿명:</strong> ${result.template.name}
                </div>
            `;
            
            // 3초 후 템플릿 저장 섹션 자동 숨김
            setTimeout(() => {
                hideTemplateSaveSection();
            }, 3000);
            
            console.log('✅ 템플릿 저장 성공:', result.template);
            
        } else {
            // 오류 메시지 표시
            document.getElementById('templateSaveResult').innerHTML = `
                <div style="background: #f8d7da; color: #721c24; padding: 10px; border-radius: 4px; text-align: center;">
                    ❌ ${result.error || '템플릿 저장에 실패했습니다.'}
                </div>
            `;
        }
        
    } catch (error) {
        console.error('템플릿 저장 오류:', error);
        document.getElementById('templateSaveResult').innerHTML = `
            <div style="background: #f8d7da; color: #721c24; padding: 10px; border-radius: 4px; text-align: center;">
                ❌ 템플릿 저장 중 오류가 발생했습니다.
            </div>
        `;
    }
}

// 템플릿 목록 불러오기
async function loadTemplateList() {
    try {
        console.log('📋 템플릿 목록 불러오기 시작');
        
        // 로딩 메시지 표시
        document.getElementById('templateLoadingMessage').style.display = 'block';
        document.getElementById('templateList').style.display = 'none';
        document.getElementById('noTemplatesMessage').style.display = 'none';
        
        const response = await fetch('/api/templates');
        const result = await response.json();
        
        if (result.success) {
            const templates = result.templates;
            console.log(`✅ 템플릿 ${templates.length}개 로드 완료`);
            
            // 로딩 메시지 숨기기
            document.getElementById('templateLoadingMessage').style.display = 'none';
            
            if (templates.length === 0) {
                // 템플릿이 없는 경우
                document.getElementById('noTemplatesMessage').style.display = 'block';
            } else {
                // 템플릿 목록 표시
                displayTemplateList(templates);
                document.getElementById('templateList').style.display = 'block';
            }
        } else {
            throw new Error(result.error || '템플릿 목록을 불러올 수 없습니다.');
        }
        
    } catch (error) {
        console.error('❌ 템플릿 목록 로드 오류:', error);
        document.getElementById('templateLoadingMessage').innerHTML = `
            <div style="color: #dc3545; text-align: center;">
                ❌ 템플릿 목록을 불러오는데 실패했습니다.<br>
                <button onclick="loadTemplateList()" class="btn" style="background: #9c27b0; color: white; margin-top: 10px;">🔄 다시 시도</button>
            </div>
        `;
    }
}

// 템플릿 목록 표시
function displayTemplateList(templates) {
    const templateCards = document.getElementById('templateCards');
    
    templateCards.innerHTML = templates.map(template => `
        <div class="template-card" onclick="selectTemplate('${template.id}')" style="
            background: white; 
            border: 2px solid #e1bee7; 
            border-radius: 8px; 
            padding: 15px; 
            margin-bottom: 10px; 
            cursor: pointer; 
            transition: all 0.3s ease;
        " onmouseover="this.style.borderColor='#9c27b0'; this.style.transform='translateY(-2px)'" 
           onmouseout="this.style.borderColor='#e1bee7'; this.style.transform='translateY(0)'">
            <div style="display: flex; justify-content: between; align-items: start;">
                <div style="flex: 1;">
                    <h5 style="color: #4a148c; margin-bottom: 8px; font-size: 1em;">${template.name}</h5>
                    <p style="color: #6a1b9a; font-size: 0.85em; margin-bottom: 8px; opacity: 0.8;">
                        ${template.description || '설명이 없습니다.'}
                    </p>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75em; color: #7b1fa2;">
                        <span>사용: ${template.usageCount || 0}회</span>
                        <span>${new Date(template.createdAt).toLocaleDateString()}</span>
                    </div>
                </div>
                <div style="margin-left: 10px; color: #9c27b0; font-size: 1.2em;">
                    📋
                </div>
            </div>
        </div>
    `).join('');
}

// 템플릿 선택
let selectedTemplate = null;

async function selectTemplate(templateId) {
    try {
        console.log('📋 템플릿 선택:', templateId);
        
        // 모든 템플릿 카드의 선택 상태 초기화
        document.querySelectorAll('.template-card').forEach(card => {
            card.style.borderColor = '#e1bee7';
            card.style.backgroundColor = 'white';
        });
        
        // 선택된 템플릿 카드 강조
        event.currentTarget.style.borderColor = '#9c27b0';
        event.currentTarget.style.backgroundColor = '#f3e5f5';
        
        // 템플릿 상세 정보 로드
        const response = await fetch(`/api/templates/${templateId}`);
        const result = await response.json();
        
        if (result.success) {
            selectedTemplate = result.template;
            console.log('✅ 템플릿 상세 정보 로드 완료:', selectedTemplate.name);
            
            // 선택된 템플릿 정보 표시
            displaySelectedTemplateInfo(selectedTemplate);
            
            // 파일 업로드 이벤트 리스너 재설정 (중요!)
            setupSavedTemplateModeEvents();
            
            // 파일 업로드 상태 확인하여 버튼 활성화
            updateTemplateProcessButton();
            
        } else {
            throw new Error(result.error || '템플릿 정보를 불러올 수 없습니다.');
        }
        
    } catch (error) {
        console.error('❌ 템플릿 선택 오류:', error);
        showAlert('error', '템플릿 정보를 불러오는데 실패했습니다.');
    }
}

// 선택된 템플릿 정보 표시
function displaySelectedTemplateInfo(template) {
    const selectedTemplateInfo = document.getElementById('selectedTemplateInfo');
    const selectedTemplateDetails = document.getElementById('selectedTemplateDetails');
    
    selectedTemplateDetails.innerHTML = `
        <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #e1bee7;">
            <strong style="color: #4a148c;">${template.name}</strong><br>
            <span style="color: #6a1b9a; font-size: 0.9em;">${template.description || '설명이 없습니다.'}</span><br>
            <div style="margin-top: 8px; font-size: 0.8em; color: #7b1fa2;">
                <span>생성일: ${new Date(template.createdAt).toLocaleString()}</span><br>
                <span>사용 횟수: ${template.usageCount || 0}회</span>
            </div>
        </div>
    `;
    
    selectedTemplateInfo.style.display = 'block';
}

// 템플릿 처리 버튼 상태 업데이트
function updateTemplateProcessButton() {
    const processBtn = document.getElementById('templateProcessBtn');
    const hasTemplate = selectedTemplate !== null;
    const hasFile = currentOrderFileId !== null;
    
    if (hasTemplate && hasFile) {
        processBtn.disabled = false;
        processBtn.style.opacity = '1';
        processBtn.style.cursor = 'pointer';
    } else {
        processBtn.disabled = true;
        processBtn.style.opacity = '0.5';
        processBtn.style.cursor = 'not-allowed';
    }
}

// 템플릿 목록 새로고침
async function refreshTemplateList() {
    await loadTemplateList();
}

// 템플릿 모드 처리 (자동 변환)
async function processTemplateMode() {
    if (!selectedTemplate || !currentOrderFileId) {
        showAlert('error', '템플릿과 주문서 파일을 모두 선택해주세요.');
        return;
    }
    
    try {
        console.log('🚀 템플릿 기반 자동 변환 시작');
        console.log('📋 선택된 템플릿:', selectedTemplate.name);
        console.log('📂 주문서 파일 ID:', currentOrderFileId);
        
        // 진행률 표시 시작
        showProgress('템플릿 기반 자동 변환을 시작합니다...');
        
        // 진행률 단계 정의
        const progressSteps = [
            { percent: 20, message: '템플릿 매핑 규칙을 적용하고 있습니다...' },
            { percent: 40, message: '주문서 데이터를 분석하고 있습니다...' },
            { percent: 60, message: '자동 매핑을 수행하고 있습니다...' },
            { percent: 80, message: '발주서를 생성하고 있습니다...' },
            { percent: 100, message: '템플릿 기반 변환이 완료되었습니다!' }
        ];
        
        // 템플릿 사용 통계 업데이트
        const statsResponse = await fetch(`/api/templates/${selectedTemplate.id}/use`, {
            method: 'POST'
        });
        
        // 진행률 시뮬레이션과 실제 작업을 병렬로 실행
        const progressPromise = simulateProgress(progressSteps, 3000);
        
        // 템플릿 기반 자동 변환 API 호출
        const workPromise = (async () => {
            console.log('🚀 템플릿 기반 변환 API 호출 준비:', {
                currentOrderFileId: currentOrderFileId,
                selectedTemplateId: selectedTemplate.id,
                selectedTemplateName: selectedTemplate.name,
                isOrderFile: currentOrderFileId && currentOrderFileId.includes('orderFile'),
                isSupplierFile: currentOrderFileId && currentOrderFileId.includes('supplierFile')
            });
            
            // 파일 ID 검증
            if (!currentOrderFileId) {
                throw new Error('주문서 파일이 업로드되지 않았습니다.');
            }
            
            if (currentOrderFileId.includes('supplierFile')) {
                throw new Error('잘못된 파일 타입입니다. 주문서 파일을 업로드해주세요.');
            }
            
            const requestData = {
                fileId: currentOrderFileId,
                templateId: selectedTemplate.id,
                templateType: 'standard'
            };
            
            console.log('📤 API 요청 데이터:', requestData);
            
            const response = await fetch('/api/orders/generate-with-template', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            return response.json();
        })();
        
        // 진행률과 실제 작업 모두 완료될 때까지 대기
        const [_, result] = await Promise.all([progressPromise, workPromise]);
        
        // 진행률 숨기기
        hideProgress();
        
        if (result.success) {
            generatedFileName = result.generatedFile;
            displayFileName = result.displayFileName || result.userFriendlyFileName;
            showGenerateResult(result);
            showStep(3);
            showStep(4);
            
            // 템플릿 저장 섹션은 숨김 (이미 템플릿 사용중이므로)
            const templateSaveSection = document.getElementById('templateSaveSection');
            if (templateSaveSection) {
                templateSaveSection.style.display = 'none';
            }
            
            console.log('✅ 템플릿 기반 자동 변환 완료');
        } else {
            showAlert('error', result.error || '템플릿 기반 변환에 실패했습니다.');
        }
        
    } catch (error) {
        hideProgress();
        console.error('❌ 템플릿 기반 변환 오류:', error);
        showAlert('error', '템플릿 기반 변환 중 오류가 발생했습니다.');
    }
}

// 이메일 전송
async function sendEmail() {
    console.log('📧 이메일 전송 함수 시작');
    
    const emailTo = document.getElementById('emailTo').value;
    const emailSubject = document.getElementById('emailSubject').value;
    const emailBody = document.getElementById('emailBody').value;
    const sendOption = document.querySelector('input[name="sendOption"]:checked')?.value;
    const scheduleTime = document.getElementById('scheduleTime').value;
    
    console.log('📋 이메일 폼 데이터:', {
        emailTo,
        emailSubject,
        emailBody,
        sendOption,
        scheduleTime,
        generatedFileName,
        displayFileName
    });
    
    // 개별 필수 항목 체크 및 구체적인 안내
    const missingItems = [];
    if (!emailTo) missingItems.push('받는 사람 이메일');
    if (!emailSubject) missingItems.push('이메일 제목');
    if (!generatedFileName) missingItems.push('첨부할 발주서 파일');
    
    if (missingItems.length > 0) {
        console.log('❌ 필수 항목 누락:', { emailTo, emailSubject, generatedFileName });
        const errorMessage = `다음 필수 항목을 입력해주세요:\n• ${missingItems.join('\n• ')}`;
        showAlert('error', errorMessage);
        
        // 누락된 첫 번째 입력 필드에 포커스
        if (!emailTo) {
            document.getElementById('emailTo')?.focus();
        } else if (!emailSubject) {
            document.getElementById('emailSubject')?.focus();
        }
        
        return;
    }
    
    try {
        console.log('📤 이메일 전송 시작');
        
        // 📊 진행바 시작
        showProgress('이메일 데이터를 준비하고 있습니다...');
        updateProgress(10, '이메일 데이터를 준비하고 있습니다...');
        
        const emailData = {
            to: emailTo,
            subject: emailSubject,
            body: emailBody,
            attachmentPath: generatedFileName,
            attachmentDisplayName: displayFileName // 사용자 친화적 파일명 추가
        };
        
        if (sendOption === 'scheduled' && scheduleTime) {
            emailData.scheduleTime = scheduleTime;
        }
        
        console.log('📋 전송할 이메일 데이터:', emailData);
        
        // 📊 진행률 업데이트 (전송 방식에 따라 메시지 변경)
        const isScheduled = sendOption === 'scheduled' && scheduleTime;
        const progressMessage = isScheduled ? 
            '이메일 예약을 설정하고 있습니다...' : 
            '서버로 이메일을 전송하고 있습니다...';
        
        updateProgress(30, progressMessage);
        
        const response = await fetch('/api/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(emailData)
        });
        
        console.log('📡 서버 응답 상태:', response.status, response.statusText);
        
        // 📊 진행률 업데이트
        const processMessage = isScheduled ? 
            '예약 전송을 등록하고 있습니다...' : 
            '서버에서 이메일을 처리하고 있습니다...';
        
        updateProgress(70, processMessage);
        
        const result = await response.json();
        console.log('📋 서버 응답 결과:', result);
        
        // 📊 진행률 업데이트
        const completingMessage = isScheduled ? 
            '예약 전송 등록을 완료하고 있습니다...' : 
            '이메일 전송을 완료하고 있습니다...';
        
        updateProgress(90, completingMessage);
        
        // 짧은 딜레이로 사용자가 진행률을 볼 수 있도록 함
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const finalMessage = isScheduled ? 
            '예약 전송 등록 완료!' : 
            '이메일 전송 완료!';
        
        updateProgress(100, finalMessage);
        
        // 짧은 딜레이 후 진행바 숨김
        setTimeout(() => {
            hideProgress();
        }, 1000);
        
        if (result.success) {
            console.log('✅ 이메일 전송 성공');
            showEmailResult('success', result.message);
            loadEmailHistory();
            updateDashboard();
        } else {
            console.log('❌ 이메일 전송 실패:', result.error);
            
            // 네트워크 오류인 경우 재시도 안내 추가
            let errorMessage = result.error || '이메일 전송에 실패했습니다.';
            if (result.suggestion) {
                errorMessage += '\n\n💡 ' + result.suggestion;
            }
            
            // 503 오류인 경우 재시도 버튼 표시
            if (response.status === 503) {
                errorMessage += '\n\n잠시 후 "이메일 전송" 버튼을 다시 클릭해주세요.';
            }
            
            showEmailResult('error', errorMessage);
        }
        
    } catch (error) {
        hideProgress();
        console.error('❌ 이메일 전송 오류:', error);
        showEmailResult('error', '이메일 전송 중 오류가 발생했습니다: ' + error.message);
        
        // 추가 알림으로 확실히 사용자에게 알림
        showAlert('error', '이메일 전송 중 오류가 발생했습니다: ' + error.message);
    }
}

// 이메일 전송 결과 표시
function showEmailResult(type, message) {
    const emailResult = document.getElementById('emailResult');
    const alertClass = type === 'success' ? 'alert-success' : 'alert-error';
    const icon = type === 'success' ? '●' : '●';
    
    emailResult.innerHTML = `
        <div class="alert ${alertClass}" style="margin-top: 20px;">
            <span style="color: ${type === 'success' ? '#28a745' : '#dc3545'}">${icon}</span> ${message}
        </div>
    `;
}

// 이메일 이력 로드
async function loadEmailHistory() {
    try {
        const response = await fetch('/api/email/history');
        const result = await response.json();
        
        if (result.success && result.history.length > 0) {
            const historyList = document.getElementById('emailHistoryList');
            
            historyList.innerHTML = result.history.slice(0, 10).map((item, displayIndex) => {
                const statusClass = item.status === 'success' ? '' : 'failed';
                const statusIcon = item.status === 'success' ? '●' : '●';
                
                // Supabase 필드명 매핑 (sent_at → sentAt, to_email → to)
                const sentAt = item.sent_at || item.sentAt;
                const toEmail = item.to_email || item.to;
                const errorMessage = item.error_message || item.error;
                
                // ID 또는 인덱스 사용 (Supabase ID가 없으면 인덱스로 fallback)
                const historyId = item.id || `index_${displayIndex}`; // UUID 또는 인덱스 기반 ID
                const isRealId = !!item.id; // 실제 DB ID인지 확인
                
                // ID 검증 완료
                
                return `
                    <div class="history-item ${statusClass}" style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; flex: 1;">
                            <input type="checkbox" class="history-checkbox" data-id="${historyId}" data-is-real-id="${isRealId}" onchange="updateDeleteButton()" style="margin-right: 10px;">
                            <div style="flex: 1;">
                                <div><strong><span style="color: ${item.status === 'success' ? '#28a745' : '#dc3545'}">${statusIcon}</span> ${toEmail || 'Unknown'}</strong></div>
                                <div>${item.subject || 'No Subject'}</div>
                                <div class="history-time">${sentAt ? new Date(sentAt).toLocaleString() : 'Unknown Time'}</div>
                                ${errorMessage ? `<div style="color: #dc3545; font-size: 0.9em;">ERROR: ${errorMessage}</div>` : ''}
                            </div>
                        </div>
                        <button class="btn" onclick="deleteSingleHistory('${historyId}', ${isRealId})" style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); margin-left: 10px; padding: 5px 10px; font-size: 0.8em;">삭제</button>
                    </div>
                `;
            }).join('');
        } else {
            const historyList = document.getElementById('emailHistoryList');
            historyList.innerHTML = '<p style="text-align: center; color: #6c757d;">전송 이력이 없습니다.</p>';
        }
        
        // 전체 선택 체크박스 초기화
        document.getElementById('selectAllHistory').checked = false;
        updateDeleteButton();
        
    } catch (error) {
        console.error('이력 로드 오류:', error);
    }
}

// 대시보드 업데이트
async function updateDashboard() {
    try {
        const response = await fetch('/api/email/history');
        const result = await response.json();
        
        if (result.success) {
            const today = new Date().toDateString();
            const todayEmails = result.history.filter(item => {
                const sentAt = item.sent_at || item.sentAt;
                return sentAt && new Date(sentAt).toDateString() === today;
            });
            
            const successEmails = result.history.filter(item => item.status === 'success');
            const successRate = result.history.length > 0 ? 
                Math.round((successEmails.length / result.history.length) * 100) : 0;
            
            const lastProcessed = result.history.length > 0 ? 
                (() => {
                    const sentAt = result.history[0].sent_at || result.history[0].sentAt;
                    return sentAt ? new Date(sentAt).toLocaleTimeString() : '-';
                })() : '-';
            
            document.getElementById('todayProcessed').textContent = todayEmails.length;
            document.getElementById('successRate').textContent = successRate + '%';
            document.getElementById('totalEmails').textContent = result.history.length;
            document.getElementById('lastProcessed').textContent = lastProcessed;
        }
    } catch (error) {
        console.error('대시보드 업데이트 오류:', error);
    }
}

// 유틸리티 함수들
function showStep(stepNumber) {
    document.getElementById(`step${stepNumber}`).classList.remove('hidden');
}

function showAlert(type, message) {
    const uploadAlert = document.getElementById('uploadAlert');
    
    // 요소가 없는 경우 콘솔로 출력하고 종료
    if (!uploadAlert) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }
    
    const alertClass = type === 'success' ? 'alert-success' : 
                      type === 'warning' ? 'alert-warning' : 
                      type === 'info' ? 'alert-info' : 'alert-error';
    const icon = type === 'success' ? '●' : 
                type === 'warning' ? '▲' : 
                type === 'info' ? 'ℹ' : '●';
    
    uploadAlert.innerHTML = `
        <div class="alert ${alertClass}">
            ${icon} ${message}
        </div>
    `;
    
    // 3초 후 자동 제거
    setTimeout(() => {
        if (uploadAlert && uploadAlert.innerHTML.includes(message)) {
            uploadAlert.innerHTML = '';
        }
    }, 3000);
}

function showLoading(message) {
    const uploadAlert = document.getElementById('uploadAlert');
    
    if (!uploadAlert) {
        console.log(`[LOADING] ${message}`);
        return;
    }
    
    uploadAlert.innerHTML = `
        <div class="alert alert-success">
            <div class="loading"></div> ${message}
        </div>
    `;
}

function hideLoading() {
    const uploadAlert = document.getElementById('uploadAlert');
    
    if (!uploadAlert) {
        return;
    }
    
    uploadAlert.innerHTML = '';
}

// 진행률 표시 시작
function showProgress(message = '처리 중...') {
    const progressContainer = document.getElementById('progressContainer');
    const progressMessage = document.getElementById('progressMessage');
    const progressPercent = document.getElementById('progressPercent');
    const progressFill = document.getElementById('progressFill');
    
    progressMessage.textContent = message;
    progressPercent.textContent = '0%';
    progressFill.style.width = '0%';
    
    progressContainer.classList.remove('hidden');
}

// 진행률 업데이트
function updateProgress(percent, message = null) {
    const progressMessage = document.getElementById('progressMessage');
    const progressPercent = document.getElementById('progressPercent');
    const progressFill = document.getElementById('progressFill');
    
    if (message) {
        progressMessage.textContent = message;
    }
    
    progressPercent.textContent = `${percent}%`;
    progressFill.style.width = `${percent}%`;
}

// 진행률 숨기기
function hideProgress() {
    const progressContainer = document.getElementById('progressContainer');
    progressContainer.classList.add('hidden');
}

// 진행률 시뮬레이션 (실제 백엔드 진행률이 없을 경우)
function simulateProgress(steps, totalDuration = 3000) {
    return new Promise((resolve) => {
        let currentStep = 0;
        const stepDuration = totalDuration / steps.length;
        
        const processStep = () => {
            if (currentStep < steps.length) {
                const step = steps[currentStep];
                updateProgress(step.percent, step.message);
                currentStep++;
                setTimeout(processStep, stepDuration);
            } else {
                resolve();
            }
        };
        
        processStep();
    });
}

// 모든 단계 초기화
function resetAllSteps() {
    // 전역 변수 초기화 (중요!)
    currentOrderFileId = null;
    currentSupplierFileId = null;
    currentMapping = {};
    generatedFileName = null;
    displayFileName = null;
    orderFileHeaders = [];
    supplierFileHeaders = [];
    
    // 직접 입력 모드 변수 초기화
    if (window.directInputData) delete window.directInputData;
    if (window.isDirectInputMode) delete window.isDirectInputMode;
    if (window.pendingDirectInputData) delete window.pendingDirectInputData;
    if (window.pendingMappedData) delete window.pendingMappedData;
    if (window.pendingAIMappings) delete window.pendingAIMappings;
    
    // STEP 2, 3, 4 숨기기
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');
    document.getElementById('step4').classList.add('hidden');
    
    // 직접 입력 폼 숨기기
    const directInputStep = document.getElementById('directInputStep');
    if (directInputStep) {
        directInputStep.classList.add('hidden');
    }
    
    // AI 매핑 확인 UI 숨기기/제거
    const aiMappingConfirmation = document.getElementById('aiMappingConfirmation');
    if (aiMappingConfirmation) {
        aiMappingConfirmation.remove();
    }
    
    // 업로드 결과 초기화
    const uploadResultOrder = document.getElementById('uploadResultOrder');
    const uploadResultSupplier = document.getElementById('uploadResultSupplier');
    const uploadAlertOrder = document.getElementById('uploadAlertOrder');
    const uploadAlertSupplier = document.getElementById('uploadAlertSupplier');
    
    if (uploadResultOrder) {
        uploadResultOrder.classList.add('hidden');
    }
    if (uploadResultSupplier) {
        uploadResultSupplier.classList.add('hidden');
    }
    if (uploadAlertOrder) {
        uploadAlertOrder.innerHTML = '';
    }
    if (uploadAlertSupplier) {
        uploadAlertSupplier.innerHTML = '';
    }
    
    // 생성 결과 초기화
    const generateResult = document.getElementById('generateResult');
    if (generateResult) {
        generateResult.innerHTML = '';
    }
    
    // 이메일 결과 초기화
    const emailResult = document.getElementById('emailResult');
    if (emailResult) {
        emailResult.innerHTML = '';
    }
    
    // 필수 필드 입력 폼 숨기기
    const missingFieldsForm = document.getElementById('missingFieldsForm');
    if (missingFieldsForm) {
        missingFieldsForm.classList.add('hidden');
    }
    
    // 파일 입력 초기화
    const fileInputOrder = document.getElementById('fileInputOrder');
    const fileInputSupplier = document.getElementById('fileInputSupplier');
    if (fileInputOrder) {
        fileInputOrder.value = '';
    }
    if (fileInputSupplier) {
        fileInputSupplier.value = '';
    }
    
    // 매핑 상태 초기화
    sessionStorage.setItem('mappingSaved', 'false');
    
    // 타겟 필드 초기화
    resetTargetFields();
    
    // GENERATE ORDER 버튼 비활성화
    setTimeout(() => {
        updateGenerateOrderButton();
    }, 100);
    
    // 진행률 숨기기
    hideProgress();
    
    // 업로드 상태에 따른 버튼 가시성 제어
    updateUploadStatusAndButtons();
}

// 타겟 필드 초기화
function resetTargetFields() {
    const targetFields = document.querySelectorAll('#targetFields .field-item');
    targetFields.forEach(field => {
        // 원래 텍스트로 복원
        const targetName = field.dataset.target;
        field.innerHTML = targetName;
        
        // 스타일 초기화
        field.style.background = '';
        field.style.color = '';
        
        // 기본 클래스만 유지
        field.className = 'field-item';
    });
}

// 전체 선택/해제
function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAllHistory');
    const historyCheckboxes = document.querySelectorAll('.history-checkbox');
    
    historyCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
    
    updateDeleteButton();
}

// 삭제 버튼 상태 업데이트
function updateDeleteButton() {
    const checkedBoxes = document.querySelectorAll('.history-checkbox:checked');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    
    if (checkedBoxes.length > 0) {
        deleteBtn.style.display = 'inline-block';
    } else {
        deleteBtn.style.display = 'none';
    }
    
    // 전체 선택 체크박스 상태 업데이트
    const allCheckboxes = document.querySelectorAll('.history-checkbox');
    const selectAllCheckbox = document.getElementById('selectAllHistory');
    
    if (allCheckboxes.length > 0) {
        selectAllCheckbox.checked = checkedBoxes.length === allCheckboxes.length;
    }
}

// 선택된 이력 삭제 (Supabase ID 기반)
async function deleteSelectedHistory() {
    const checkedBoxes = document.querySelectorAll('.history-checkbox:checked');
    
    if (checkedBoxes.length === 0) {
        showAlert('warning', '삭제할 항목을 선택해주세요.');
        return;
    }
    
    if (!confirm(`선택된 ${checkedBoxes.length}개 항목을 삭제하시겠습니까?`)) {
        return;
    }
    
    try {
        showLoading('선택된 이력을 삭제하고 있습니다...');
        
        // 체크박스에서 ID 수집 및 타입 구분
        const checkboxData = Array.from(checkedBoxes).map(checkbox => ({
            id: checkbox.dataset.id,
            isRealId: checkbox.dataset.isRealId === 'true'
        }));
        
        // 실제 ID와 인덱스로 분류
        const realIds = checkboxData.filter(item => item.isRealId && !item.id.startsWith('index_')).map(item => item.id);
        const indexIds = checkboxData.filter(item => !item.isRealId || item.id.startsWith('index_')).map(item => {
            return item.id.startsWith('index_') ? parseInt(item.id.replace('index_', '')) : parseInt(item.id);
        });
        
        // 요청 데이터 구성
        let requestBody = {};
        if (realIds.length > 0) {
            requestBody.historyIds = realIds;
        }
        if (indexIds.length > 0) {
            requestBody.indices = indexIds;
        }
        
        const response = await fetch('/api/email/history/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        hideLoading();
        
        if (result.success) {
            const totalCount = (realIds.length || 0) + (indexIds.length || 0);
            showAlert('success', `${result.deletedCount || totalCount}개 항목이 삭제되었습니다.`);
            loadEmailHistory();
            updateDashboard();
        } else {
            showAlert('error', result.error || '이력 삭제에 실패했습니다.');
        }
        
    } catch (error) {
        hideLoading();
        console.error('이력 삭제 오류:', error);
        showAlert('error', '이력 삭제 중 오류가 발생했습니다.');
    }
}

// 단일 이력 삭제 (Supabase ID 또는 인덱스 기반)
async function deleteSingleHistory(historyId, isRealId = true) {
    if (!confirm('이 이력을 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        showLoading('이력을 삭제하고 있습니다...');
        
        let requestBody;
        if (isRealId && !historyId.startsWith('index_')) {
            // 실제 Supabase ID 사용
            requestBody = { historyIds: [historyId] };
        } else {
            // 인덱스 기반 - 인덱스 추출
            const index = historyId.startsWith('index_') ? 
                parseInt(historyId.replace('index_', '')) : 
                parseInt(historyId);
            requestBody = { indices: [index] };
        }
        
        const response = await fetch('/api/email/history/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        hideLoading();
        
        if (result.success) {
            showAlert('success', '이력이 삭제되었습니다.');
            loadEmailHistory();
            updateDashboard();
        } else {
            showAlert('error', result.error || '이력 삭제에 실패했습니다.');
        }
        
    } catch (error) {
        hideLoading();
        console.error('이력 삭제 오류:', error);
        showAlert('error', '이력 삭제 중 오류가 발생했습니다.');
    }
}

// 전체 이력 삭제
async function clearAllHistory() {
    if (!confirm('모든 전송 이력을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        return;
    }
    
    try {
        showLoading('모든 이력을 삭제하고 있습니다...');
        
        const response = await fetch('/api/email/history/clear', {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        hideLoading();
        
        if (result.success) {
            showAlert('success', '모든 이력이 삭제되었습니다.');
            loadEmailHistory();
            updateDashboard();
        } else {
            showAlert('error', result.error || '이력 삭제에 실패했습니다.');
        }
        
    } catch (error) {
        hideLoading();
        console.error('이력 삭제 오류:', error);
        showAlert('error', '이력 삭제 중 오류가 발생했습니다.');
    }
}

// 🎯 표준 타겟 필드 설정


// 📊 필드 검증 (필수 체크 제거)
function validateRequiredFields(mapping) {
    // 매핑된 필드가 있는지만 확인
    return {
        isValid: Object.keys(mapping).length > 0,
        missingFields: [],
        message: Object.keys(mapping).length > 0 ? 
            '매핑이 설정되었습니다.' : 
            '최소 1개 이상의 필드를 매핑해주세요.'
    };
}

// 🔄 필수 필드 입력 폼 표시
function showMissingFieldsForm(missingFields) {
    const form = document.getElementById('missingFieldsForm');
    const container = document.getElementById('missingFieldsContainer');
    
    // 기존 내용 초기화
    container.innerHTML = '';
    
    // 각 누락된 필드에 대해 입력 필드 생성
    missingFields.forEach(field => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'form-group';
        fieldDiv.style.marginBottom = '15px';
        
        const label = document.createElement('label');
        label.textContent = field;
        label.style.fontWeight = '600';
        label.style.color = '#856404';
        label.style.marginBottom = '5px';
        label.style.display = 'block';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control';
        input.id = `missing_${field}`;
        input.placeholder = `${field}를 입력하세요`;
        input.style.width = '100%';
        input.style.padding = '8px 12px';
        input.style.border = '1px solid #dee2e6';
        input.style.borderRadius = '4px';
        input.style.fontSize = '0.9em';
        
        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);
        container.appendChild(fieldDiv);
    });
    
    // 폼 표시
    form.classList.remove('hidden');
    
    // 폼으로 스크롤
    form.scrollIntoView({ behavior: 'smooth' });
}

// 💾 필수 필드 저장
async function saveMissingFields() {
    const form = document.getElementById('missingFieldsForm');
    const inputs = form.querySelectorAll('input[id^="missing_"]');
    
    // 입력값 검증
    let hasEmptyFields = false;
    const fieldValues = {};
    
    inputs.forEach(input => {
        const fieldName = input.id.replace('missing_', '');
        const value = input.value.trim();
        
        if (value === '') {
            hasEmptyFields = true;
            input.style.borderColor = '#dc3545';
        } else {
            input.style.borderColor = '#dee2e6';
            fieldValues[fieldName] = value;
        }
    });
    
    if (hasEmptyFields) {
        showAlert('warning', '모든 필수 필드를 입력해주세요.');
        return;
    }
    
    try {
        // 현재 매핑에 입력값들을 추가 (고정값으로 설정)
        Object.keys(fieldValues).forEach(field => {
            currentMapping[field] = `[고정값: ${fieldValues[field]}]`;
        });
        
        // 매핑 저장
        const mappingData = {
            mappingName: `mapping_${Date.now()}`,
            sourceFields: Object.values(currentMapping),
            targetFields: Object.keys(currentMapping),
            mappingRules: currentMapping,
            fixedValues: fieldValues // 고정값들을 별도로 전송
        };
        
        showLoading('매핑 규칙을 저장하고 있습니다...');
        
        const response = await fetch('/api/orders/mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mappingData)
        });
        
        const result = await response.json();
        
        hideLoading();
        
        if (result.success) {
            // 타겟 필드들의 매핑 상태 업데이트
            Object.keys(fieldValues).forEach(field => {
                const targetField = document.querySelector(`[data-target="${field}"]`);
                if (targetField) {
                    targetField.classList.add('selected');
                    targetField.textContent = `${field} ← [고정값]`;
                }
            });
            
            showAlert('success', '✅ 필수 정보가 저장되었습니다. 매핑이 완료되었습니다.');
            
            // 매핑 저장 상태 표시
            sessionStorage.setItem('mappingSaved', 'true');
            
            // GENERATE ORDER 버튼 활성화
            updateGenerateOrderButton();
            
            // 폼 숨기기
            hideMissingFieldsForm();
            
        } else {
            showAlert('error', result.error || '매핑 저장에 실패했습니다.');
        }
        
    } catch (error) {
        hideLoading();
        console.error('필수 필드 저장 오류:', error);
        showAlert('error', '필수 필드 저장 중 오류가 발생했습니다.');
    }
}

// 🚫 필수 필드 입력 폼 숨기기
function hideMissingFieldsForm() {
    const form = document.getElementById('missingFieldsForm');
    form.classList.add('hidden');
}

// 📝 직접 입력 폼 표시
function showDirectInputForm() {
    // 필요한 단계만 숨기기 (발주서 파일 업로드 결과는 유지)
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');
    document.getElementById('step4').classList.add('hidden');
    
    // 필수 필드 입력 폼 숨기기
    const missingFieldsForm = document.getElementById('missingFieldsForm');
    if (missingFieldsForm) {
        missingFieldsForm.classList.add('hidden');
    }
    
    // 매핑 상태 초기화
    currentMapping = {};
    sessionStorage.setItem('mappingSaved', 'false');
    
    // 직접 입력 폼 표시
    const directInputStep = document.getElementById('directInputStep');
    directInputStep.classList.remove('hidden');
    
    // 폼으로 스크롤
    directInputStep.scrollIntoView({ behavior: 'smooth' });
}

// 📋 직접 입력 데이터로 STEP 2 매핑 설정
function setupDirectInputMapping(inputData) {
    console.log('📋 직접 입력 데이터로 매핑 설정 시작:', inputData);
    
    // 직접 입력 데이터를 가상의 source fields로 설정
    const directInputFields = Object.keys(inputData);
    
    // 전역 변수 설정 (기존 파일 업로드와 동일한 방식)
    orderFileHeaders = directInputFields;
    currentOrderFileId = 'direct_input'; // 가상 파일 ID
    
    // 직접 입력 데이터 저장 (매핑 완료 후 사용)
    window.directInputData = inputData;
    window.isDirectInputMode = true;
    
    console.log('✅ 직접 입력 모드 설정 완료');
    console.log('📊 Source Fields:', directInputFields);
    console.log('📊 Target Fields:', supplierFileHeaders);
    
    // 직접 입력 폼 숨기기
    document.getElementById('directInputStep').classList.add('hidden');
    
    // STEP 2 매핑 설정으로 이동
    setupMapping();
    showStep(2);
    
    // 사용자 안내 메시지
    showAlert('info', '📋 직접 입력된 데이터와 업로드된 발주서 템플릿의 필드를 매핑해주세요.');
}

// 🔄 직접 입력 데이터를 기본 템플릿 필드로 자동 매핑
function mapDirectInputToTemplate(inputData) {
    console.log('🔄 직접 입력 데이터 자동 매핑 시작:', inputData);
    
    // 직접 입력 필드 → 기본 템플릿 필드 매핑 규칙
    const fieldMappings = {
        '상품명': '품목명',
        '연락처': '전화번호',
        '주소': '주소',
        '수량': '주문수량',
        '단가': '단가',
        '고객명': '담당자'
    };
    
    const mappedData = {};
    
    // 기본 필드 매핑 적용
    Object.keys(inputData).forEach(directField => {
        const templateField = fieldMappings[directField];
        if (templateField) {
            mappedData[templateField] = inputData[directField];
            console.log(`✅ 매핑: ${directField} → ${templateField} = "${inputData[directField]}"`);
        } else {
            // 매핑 규칙이 없는 경우 원본 필드명 사용
            mappedData[directField] = inputData[directField];
            console.log(`ℹ️ 직접 매핑: ${directField} = "${inputData[directField]}"`);
        }
    });
    
    // 자동 계산 및 기본값 추가
    if (mappedData['주문수량'] && mappedData['단가']) {
        const quantity = parseInt(mappedData['주문수량']) || 0;
        const price = parseFloat(mappedData['단가']) || 0;
        const total = quantity * price;
        
        if (total > 0) {
            mappedData['공급가액'] = total;
            console.log(`💰 공급가액 자동 계산: ${quantity} × ${price} = ${total}`);
        }
    }
    
    // 자동 생성 필드 추가
    const now = new Date();
    mappedData['발주일자'] = now.toISOString().split('T')[0]; // YYYY-MM-DD
    mappedData['발주번호'] = `PO-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
    
    // 공급처 기본값 (고객명이 있으면 고객명 사용, 없으면 기본값)
    if (!mappedData['공급처']) {
        mappedData['공급처'] = mappedData['담당자'] || '미입력';
    }
    
    console.log('✅ 직접 입력 데이터 매핑 완료:', mappedData);
    return mappedData;
}

// 💾 직접 입력 데이터 저장 및 발주서 생성
async function saveDirectInput() {
    const inputData = {};
    let hasAnyInput = false;
    
    // 모든 필드 값 수집
    ['상품명', '연락처', '주소', '수량', '단가', '고객명'].forEach(field => {
        const input = document.getElementById(`direct_${field}`);
        const value = input.value.trim();
        
        input.style.borderColor = '#dee2e6';
        if (value !== '') {
            inputData[field] = value;
            hasAnyInput = true;
        }
    });
    
    if (!hasAnyInput) {
        showAlert('warning', '최소 1개 이상의 필드를 입력해주세요.');
        return;
    }
    
    try {
        // 발주서 템플릿 업로드 여부에 따른 분기 처리
        if (currentSupplierFileId && supplierFileHeaders.length > 0) {
            // 1. 발주서 템플릿이 업로드된 경우 → STEP 2 매핑 설정으로 이동
            console.log('📋 발주서 템플릿이 업로드되어 있음 - STEP 2 매핑 설정으로 이동');
            setupDirectInputMapping(inputData);
        } else {
            // 2. 발주서 템플릿이 없는 경우 → 기본 템플릿 자동 매핑
            console.log('📋 발주서 템플릿 없음 - 기본 템플릿 자동 매핑');
            await processDirectInputWithDefaultTemplate(inputData);
        }
        
    } catch (error) {
        hideLoading();
        console.error('직접 입력 저장 오류:', error);
        showAlert('error', '직접 입력 처리 중 오류가 발생했습니다.');
    }
}

// 🤖 발주서 템플릿과 AI 매핑을 사용한 직접 입력 처리
async function processDirectInputWithAIMapping(inputData) {
    showLoading('AI가 직접 입력 데이터와 발주서 템플릿을 매핑하고 있습니다...');
    
    try {
        // 직접 입력 필드 목록 생성
        const directInputFields = Object.keys(inputData);
        
        console.log('🤖 AI 매핑 요청:', {
            directInputFields,
            supplierFields: supplierFileHeaders
        });
        
        // AI 매핑 요청
        const mappingResponse = await fetch('/api/orders/ai-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderFields: directInputFields,
                supplierFields: supplierFileHeaders
            })
        });
        
        if (mappingResponse.status === 401) {
            hideLoading();
            showAlert('warning', '🔐 OpenAI API 키 인증이 필요합니다. 인증 페이지로 이동합니다.');
            setTimeout(() => window.location.href = '/auth.html', 2000);
            return;
        }
        
        const mappingResult = await mappingResponse.json();
        
        if (!mappingResult.success) {
            if (mappingResult.requireAuth) {
                hideLoading();
                showAlert('warning', '🔐 OpenAI API 키 인증이 필요합니다. 인증 페이지로 이동합니다.');
                setTimeout(() => window.location.href = '/auth.html', 2000);
                return;
            }
            throw new Error(mappingResult.error || 'AI 매핑에 실패했습니다.');
        }
        
        // AI 매핑 결과 적용
        const aiMappings = mappingResult.mappings;
        const mappedData = {};
        
        // AI 매핑 결과를 바탕으로 데이터 변환
        Object.entries(aiMappings).forEach(([targetField, sourceField]) => {
            if (inputData[sourceField]) {
                mappedData[targetField] = inputData[sourceField];
                console.log(`🤖 AI 매핑: ${sourceField} → ${targetField} = "${inputData[sourceField]}"`);
            }
        });
        
        // 매핑되지 않은 직접 입력 데이터도 포함
        Object.entries(inputData).forEach(([field, value]) => {
            const isMapped = Object.values(aiMappings).includes(field);
            if (!isMapped) {
                mappedData[field] = value;
                console.log(`ℹ️ 직접 포함: ${field} = "${value}"`);
            }
        });
        
        hideLoading();
        
        // AI 매핑 결과를 사용자에게 보여주고 확인받기
        showDirectInputMappingConfirmation(inputData, mappedData, aiMappings);
        
    } catch (error) {
        hideLoading();
        console.error('AI 매핑 처리 오류:', error);
        showAlert('error', 'AI 매핑 중 오류가 발생했습니다.');
    }
}

// 📋 기본 템플릿을 사용한 직접 입력 처리
async function processDirectInputWithDefaultTemplate(inputData) {
    showLoading('직접 입력 데이터로 발주서를 생성하고 있습니다...');
    
    try {
        // 직접 입력 데이터를 기본 템플릿 필드로 자동 매핑
        const mappedData = mapDirectInputToTemplate(inputData);
        
        // 직접 입력 데이터를 매핑 형태로 변환
        const mappingData = {
            mappingName: `direct_input_${Date.now()}`,
            sourceFields: [],
            targetFields: Object.keys(mappedData),
            mappingRules: {},
            fixedValues: mappedData,
            isDirect: true // 직접 입력 플래그
        };
        
        // 매핑 저장
        const mappingResponse = await fetch('/api/orders/mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mappingData)
        });
        
        const mappingResult = await mappingResponse.json();
        
        if (!mappingResult.success) {
            throw new Error(mappingResult.error || '매핑 저장에 실패했습니다.');
        }
        
        // 직접 입력 데이터로 발주서 생성
        const generateResponse = await fetch('/api/orders/generate-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mappingId: mappingData.mappingName,
                inputData: mappedData,
                templateType: 'standard',
                supplierFileId: currentSupplierFileId
            })
        });
        
        const generateResult = await generateResponse.json();
        
        hideLoading();
        
        if (generateResult.success) {
            generatedFileName = generateResult.generatedFile;
            displayFileName = generateResult.displayFileName || generateResult.userFriendlyFileName;
            
            // 성공 결과 표시
            showAlert('success', '✅ 직접 입력 데이터로 발주서가 생성되었습니다!');
            
            // 결과 표시 및 이메일 단계로 이동
            showDirectInputResult(generateResult, mappedData);
            showStep(3);
            showStep(4);
            
        } else {
            showAlert('error', generateResult.error || '발주서 생성에 실패했습니다.');
        }
        
    } catch (error) {
        hideLoading();
        console.error('기본 템플릿 처리 오류:', error);
        showAlert('error', '기본 템플릿 처리 중 오류가 발생했습니다.');
    }
}

// 🤖 AI 매핑 결과 확인 UI 표시
function showDirectInputMappingConfirmation(inputData, mappedData, aiMappings) {
    // 직접 입력 폼 숨기기
    document.getElementById('directInputStep').classList.add('hidden');
    
    // 매핑 확인 UI 표시
    const confirmationHtml = `
        <div class="step" id="aiMappingConfirmation">
            <h3>🤖 AI 매핑 결과 확인</h3>
            <p>AI가 직접 입력된 데이터를 발주서 템플릿과 자동 매핑했습니다. 결과를 확인하고 진행해주세요.</p>
            
            <div style="background: linear-gradient(145deg, #e8f4fd 0%, #b3e5fc 100%); padding: 20px; border-radius: 10px; margin: 20px 0;">
                <h4 style="color: #1976d2; margin-bottom: 15px;">🤖 AI 매핑 결과</h4>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">
                    ${Object.entries(aiMappings).map(([targetField, sourceField]) => `
                        <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="font-weight: bold; color: #1976d2;">${targetField}</span>
                                <span style="color: #666;">←</span>
                                <span style="color: #4caf50;">${sourceField}</span>
                            </div>
                            <div style="margin-top: 8px; color: #666; font-size: 0.9em;">
                                값: "${inputData[sourceField] || ''}"
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                ${Object.keys(aiMappings).length === 0 ? 
                    '<div style="text-align: center; color: #ff9800; padding: 20px;"><strong>⚠️ AI가 자동 매핑할 수 있는 필드를 찾지 못했습니다.</strong></div>' : 
                    `<div style="text-align: center; margin-top: 15px; color: #4caf50;">
                        <strong>✅ ${Object.keys(aiMappings).length}개 필드가 자동 매핑되었습니다!</strong>
                    </div>`
                }
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <button class="btn btn-success" onclick="confirmAIMapping()">✅ 매핑 확인 및 발주서 생성</button>
                <button class="btn" onclick="cancelAIMapping()">🔙 직접 입력으로 돌아가기</button>
            </div>
        </div>
    `;
    
    // 기존 확인 UI 제거 후 새로 추가
    const existingConfirmation = document.getElementById('aiMappingConfirmation');
    if (existingConfirmation) {
        existingConfirmation.remove();
    }
    
    // step2 다음에 삽입
    const step2 = document.getElementById('step2');
    step2.insertAdjacentHTML('afterend', confirmationHtml);
    
    // 전역 변수에 저장 (확인 시 사용)
    window.pendingDirectInputData = inputData;
    window.pendingMappedData = mappedData;
    window.pendingAIMappings = aiMappings;
}

// ✅ AI 매핑 확인 및 발주서 생성
async function confirmAIMapping() {
    try {
        showLoading('AI 매핑 결과로 발주서를 생성하고 있습니다...');
        
        const mappedData = window.pendingMappedData;
        const aiMappings = window.pendingAIMappings;
        
        // 매핑 데이터 준비
        const mappingData = {
            mappingName: `ai_direct_input_${Date.now()}`,
            sourceFields: Object.keys(window.pendingDirectInputData),
            targetFields: Object.keys(aiMappings),
            mappingRules: aiMappings,
            fixedValues: mappedData,
            isDirect: true,
            isAIMapped: true
        };
        
        // 매핑 저장
        const mappingResponse = await fetch('/api/orders/mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mappingData)
        });
        
        const mappingResult = await mappingResponse.json();
        
        if (!mappingResult.success) {
            throw new Error(mappingResult.error || '매핑 저장에 실패했습니다.');
        }
        
        // 발주서 생성
        const generateResponse = await fetch('/api/orders/generate-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mappingId: mappingData.mappingName,
                inputData: mappedData,
                templateType: 'standard',
                supplierFileId: currentSupplierFileId
            })
        });
        
        const generateResult = await generateResponse.json();
        
        hideLoading();
        
        if (generateResult.success) {
            generatedFileName = generateResult.generatedFile;
            displayFileName = generateResult.displayFileName || generateResult.userFriendlyFileName;
            
            // AI 매핑 확인 UI 숨기기
            document.getElementById('aiMappingConfirmation').classList.add('hidden');
            
            // 성공 결과 표시
            showAlert('success', '✅ AI 매핑 결과로 발주서가 생성되었습니다!');
            
            // 결과 표시 및 이메일 단계로 이동
            showDirectInputResult(generateResult, mappedData, aiMappings);
            showStep(3);
            showStep(4);
            
        } else {
            showAlert('error', generateResult.error || '발주서 생성에 실패했습니다.');
        }
        
    } catch (error) {
        hideLoading();
        console.error('AI 매핑 확인 처리 오류:', error);
        showAlert('error', 'AI 매핑 발주서 생성 중 오류가 발생했습니다.');
    }
}

// 🔙 AI 매핑 취소 및 직접 입력으로 돌아가기
function cancelAIMapping() {
    // AI 매핑 확인 UI 숨기기
    const confirmationElement = document.getElementById('aiMappingConfirmation');
    if (confirmationElement) {
        confirmationElement.classList.add('hidden');
    }
    
    // 직접 입력 폼 다시 표시
    document.getElementById('directInputStep').classList.remove('hidden');
    
    // 전역 변수 정리
    delete window.pendingDirectInputData;
    delete window.pendingMappedData;
    delete window.pendingAIMappings;
    
    showAlert('info', '직접 입력 화면으로 돌아갔습니다. 다시 입력해주세요.');
}

// 📋 직접 입력 결과 표시
function showDirectInputResult(result, mappedData, aiMappings = null) {
    const generateResult = document.getElementById('generateResult');
    
    // 매핑된 데이터 표시
    const mappedFieldsHtml = Object.entries(mappedData || {})
        .map(([field, value]) => `<li><strong>${field}:</strong> ${value}</li>`)
        .join('');
    
    // AI 매핑 여부에 따른 제목과 설명
    const isAIMapped = aiMappings && Object.keys(aiMappings).length > 0;
    const titleText = isAIMapped ? 
        '🤖 AI 매핑으로 발주서가 성공적으로 생성되었습니다!' : 
        '✅ 직접 입력 데이터로 발주서가 성공적으로 생성되었습니다!';
    
    const mappingTypeText = isAIMapped ? 
        `🤖 AI가 업로드된 발주서 템플릿으로 자동 매핑한 데이터 (${Object.keys(aiMappings).length}개 필드 매핑):` : 
        '📋 기본 템플릿으로 매핑된 데이터:';
    
    generateResult.innerHTML = `
        <div class="alert alert-success">
            ${titleText}<br>
            <strong>매핑된 정보:</strong> ${Object.keys(mappedData || {}).length}개 필드<br>
            <strong>생성된 파일:</strong> ${result.generatedFile}
        </div>
        
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h5 style="color: #495057; margin-bottom: 10px;">${mappingTypeText}</h5>
            <ul style="margin: 0; padding-left: 20px; color: #6c757d;">
                ${mappedFieldsHtml}
            </ul>
        </div>
        
        ${isAIMapped ? `
        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h5 style="color: #1976d2; margin-bottom: 10px;">🤖 AI 매핑 상세:</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                ${Object.entries(aiMappings).map(([targetField, sourceField]) => `
                    <div style="background: white; padding: 10px; border-radius: 6px; font-size: 0.9em;">
                        <strong>${sourceField}</strong> → ${targetField}
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        <div style="text-align: center; margin-top: 20px;">
            <a href="${result.downloadUrl}" class="btn btn-success" download>DOWNLOAD ORDER</a>
        </div>
    `;
}

// 🚫 직접 입력 취소
function cancelDirectInput() {
    // 직접 입력 폼의 입력값 초기화
    ['상품명', '연락처', '주소', '수량', '단가', '고객명'].forEach(field => {
        const input = document.getElementById(`direct_${field}`);
        if (input) {
            input.value = '';
            input.style.borderColor = '#dee2e6';
        }
    });
    
    // 모든 상태 초기화 (resetAllSteps 사용)
    resetAllSteps();
    
    // 1단계만 표시
    const step1 = document.getElementById('step1');
    if (step1) {
        step1.classList.remove('hidden');
    }
    
    console.log('🔄 직접 입력 취소: 모든 상태 초기화 완료');
}

// 🔐 인증 상태 확인 함수 (OpenAI API 키 선택적)
async function checkAuthenticationStatus() {
    try {
        console.log('🔍 인증 상태 확인 중...');
        
        const response = await fetch('/api/auth/check');
        const result = await response.json();
        
        console.log('✅ 시스템 접근 가능:', {
            hasApiKey: result.hasApiKey,
            isAdmin: result.isAdmin,
            username: result.username
        });
        
        // 전역 변수에 API 키 상태 저장
        window.hasOpenAIKey = result.hasApiKey;
        
        // 인증 상태 표시
        addAuthenticationIndicator(result.authenticatedAt, result.isAdmin, result.username, result.hasApiKey);
        
        // AI 기능 버튼 상태 업데이트
        updateAIFeatureButtons(result.hasApiKey);
        
        return true;
        
    } catch (error) {
        console.error('❌ 인증 상태 확인 오류:', error);
        // 네트워크 오류 등의 경우 일단 진행
        console.log('⚠️ 인증 확인 실패 - API 키 없이 진행');
        window.hasOpenAIKey = false;
        updateAIFeatureButtons(false);
        return true;
    }
}

// 🔐 인증 상태 표시기 추가 (선택사항)
function addAuthenticationIndicator(authenticatedAt, isAdmin = false, username = null) {
    const header = document.querySelector('.header');
    if (!header) return;
    
    const authIndicator = document.createElement('div');
    authIndicator.style.cssText = `
        position: absolute;
        top: 10px;
        right: 20px;
        background: ${isAdmin ? 'rgba(255, 193, 7, 0.3)' : 'rgba(255, 255, 255, 0.2)'};
        color: #f8f9fa;
        padding: 5px 12px;
        border-radius: 15px;
        font-size: 0.8em;
        backdrop-filter: blur(10px);
        border: 1px solid ${isAdmin ? 'rgba(255, 193, 7, 0.5)' : 'rgba(255, 255, 255, 0.3)'};
        cursor: pointer;
        box-shadow: ${isAdmin ? '0 2px 8px rgba(255, 193, 7, 0.3)' : 'none'};
    `;
    
    const authTime = new Date(authenticatedAt).toLocaleString('ko-KR');
    let displayText = '';
    
    if (isAdmin) {
        displayText = `👨‍💼 관리자 (${username || 'admin'}) - ${authTime}`;
    } else {
        displayText = `🔐 인증됨 (${authTime})`;
    }
    
    authIndicator.innerHTML = displayText;
    
    // 로그아웃 기능 추가
    authIndicator.addEventListener('click', showAuthMenu);
    
    header.appendChild(authIndicator);
}

// 🔐 인증 메뉴 표시
function showAuthMenu() {
    if (confirm('로그아웃하시겠습니까?')) {
        logout();
    }
}

// 🚪 로그아웃 함수
async function logout() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('로그아웃되었습니다.');
            window.location.href = '/auth.html';
        } else {
            alert('로그아웃 중 오류가 발생했습니다.');
        }
        
    } catch (error) {
        console.error('로그아웃 오류:', error);
        alert('로그아웃 중 오류가 발생했습니다.');
    }
}

// 🔄 특정 파일 다시 업로드 함수
function restartFileUpload(type) {
    const fileTypeText = type === 'order' ? '주문서' : '발주서';
    
    if (confirm(`${fileTypeText} 파일을 다시 업로드하시겠습니까?`)) {
        // 진행 중인 요청 취소
        if (currentUploadController) {
            currentUploadController.abort();
            currentUploadController = null;
        }
        
        // 처리 상태 초기화
        isProcessing = false;
        
        // 진행률 표시 및 로딩 상태 강제 해제
        hideProgress();
        hideLoading();
        
        // 해당 파일 타입의 전역 변수만 초기화
        if (type === 'order') {
            currentOrderFileId = null;
            orderFileHeaders = [];
        } else if (type === 'supplier') {
            currentSupplierFileId = null;
            supplierFileHeaders = [];
        }
        
        // 해당 파일 타입의 UI 요소 초기화
        const uploadResultId = type === 'order' ? 'uploadResultOrder' : 'uploadResultSupplier';
        const uploadAlertId = type === 'order' ? 'uploadAlertOrder' : 'uploadAlertSupplier';
        const fileInputId = type === 'order' ? 'fileInputOrder' : 'fileInputSupplier';
        
        // 업로드 결과 숨기기
        const uploadResult = document.getElementById(uploadResultId);
        if (uploadResult) {
            uploadResult.classList.add('hidden');
        }
        
        // 알림 영역 초기화
        const uploadAlert = document.getElementById(uploadAlertId);
        if (uploadAlert) {
            uploadAlert.innerHTML = '';
        }
        
        // 파일 입력 초기화
        const fileInput = document.getElementById(fileInputId);
        if (fileInput) {
            fileInput.value = '';
        }
        
        // 매핑이 설정되어 있었다면 초기화 (다른 파일이 있는 경우만)
        if (type === 'order' && currentSupplierFileId) {
            // 주문서를 다시 업로드하는 경우, 발주서가 있으면 매핑 재설정 필요
            currentMapping = {};
            resetMappingState();
            showAlert('info', `${fileTypeText} 파일이 초기화되었습니다. 다시 업로드해주세요.`);
        } else if (type === 'supplier' && currentOrderFileId) {
            // 발주서를 다시 업로드하는 경우, 주문서가 있으면 매핑 재설정 필요
            currentMapping = {};
            resetMappingState();
            showAlert('info', `${fileTypeText} 파일이 초기화되었습니다. 다시 업로드해주세요.`);
        } else {
            showAlert('info', `${fileTypeText} 파일이 초기화되었습니다. 다시 업로드해주세요.`);
        }
        
        // 업로드 상태 및 버튼 업데이트
        updateUploadStatusAndButtons();
        
        // STEP 1으로 돌아가기 (두 파일이 모두 없어진 경우)
        if (!currentOrderFileId && !currentSupplierFileId) {
            showStep(1);
        } else if (currentOrderFileId && currentSupplierFileId) {
            // 두 파일이 모두 있는 경우 매핑 재설정
            try {
                showStep(2);
                setupMapping();
            } catch (error) {
                console.error('매핑 재설정 오류:', error);
            }
        }
        
        console.log(`🔄 ${fileTypeText} 파일 재시작 완료`);
    }
}

// 🔄 전체 프로세스 재시작 함수
function restartProcess() {
    // 진행 중인 작업이 있는지 확인
    const confirmMessage = isProcessing ? 
        '현재 파일 처리가 진행 중입니다. 작업을 취소하고 처음부터 다시 시작하시겠습니까?' :
        '모든 진행사항이 초기화됩니다. 처음부터 다시 시작하시겠습니까?';
    
    if (confirm(confirmMessage)) {
        // 진행 중인 요청 취소
        if (currentUploadController) {
            currentUploadController.abort();
            currentUploadController = null;
        }
        
        if (currentProcessingController) {
            currentProcessingController.abort();
            currentProcessingController = null;
        }
        
        // 처리 상태 초기화
        isProcessing = false;
        
        // 진행률 표시 및 로딩 상태 강제 해제
        hideProgress();
        hideLoading();
        
        // 모든 전역 변수 초기화
        currentOrderFileId = null;
        currentSupplierFileId = null;
        currentMapping = {};
        generatedFileName = null;
        displayFileName = null;
        orderFileHeaders = [];
        supplierFileHeaders = [];
        
        // 템플릿 관련 변수 초기화
        selectedTemplate = null;
        
        // 세션 스토리지 초기화
        sessionStorage.setItem('mappingSaved', 'false');
        
        // 펜딩 데이터 정리
        delete window.pendingDirectInputData;
        delete window.pendingMappedData;
        delete window.pendingAIMappings;
        
        // 모든 스텝 초기화
        resetAllSteps();
        
        // 전역 모드 변수 초기화
        window.currentWorkMode = 'fileUpload';
        window.isDirectInputMode = false;
        
        // 라디오 버튼 먼저 설정 (value로 접근)
        const fileUploadRadio = document.querySelector('input[name="workMode"][value="fileUpload"]');
        if (fileUploadRadio) {
            fileUploadRadio.checked = true;
        }
        
        // 다른 라디오 버튼들 해제
        ['directInput', 'defaultTemplate', 'savedTemplate'].forEach(value => {
            const radio = document.querySelector(`input[name="workMode"][value="${value}"]`);
            if (radio) radio.checked = false;
        });
        
        // 모드 변경으로 UI 완전 초기화
        changeWorkMode('fileUpload');
        
        // 파일 업로드 이벤트 재설정
        setupFileUploadEvents();
        
        // 첫 번째 스텝만 표시
        const step1 = document.getElementById('step1');
        if (step1) {
            step1.classList.remove('hidden');
        }
        
        // 업로드 결과 초기화 (기본 + 모든 모드별)
        const uploadResultElements = [
            'uploadResultOrder',
            'uploadResultSupplier',
            'uploadResultOrderDirect',
            'uploadResultSupplierDirect',
            'uploadResultOrderDefault',
            'uploadResultSupplierDefault',
            'uploadResultOrderSaved',
            'uploadResultSupplierSaved',
            'uploadResultTemplateMode'
        ];
        
        uploadResultElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.classList.add('hidden');
                // innerHTML = ''를 사용하면 자식 요소들이 삭제되므로, 
                // 대신 각 자식 요소의 내용만 지우기
                const alertChild = element.querySelector('[id*="Alert"]');
                if (alertChild) {
                    alertChild.innerHTML = '';
                }
            }
        });
        
        // 알림 영역 초기화 (기본 + 모든 모드별)
        const alertElements = [
            'uploadAlert',
            'uploadAlertOrder',
            'uploadAlertSupplier',
            'uploadAlertDirectMode',
            'uploadAlertDefaultMode',
            'uploadAlertSavedMode',
            'uploadAlertSupplierDirectMode',
            'uploadAlertTemplateMode'
        ];
        
        alertElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.innerHTML = '';
                // 알림 요소는 숨기지 않음 (상위 컨테이너가 관리)
            }
        });
        
        // 선택된 템플릿 정보 숨기기 및 초기화
        const selectedTemplateInfo = document.getElementById('selectedTemplateInfo');
        if (selectedTemplateInfo) {
            selectedTemplateInfo.style.display = 'none';
        }
        
        const selectedTemplateDetails = document.getElementById('selectedTemplateDetails');
        if (selectedTemplateDetails) {
            selectedTemplateDetails.innerHTML = '';
        }
        
        // 템플릿 처리 버튼 비활성화
        const templateProcessBtn = document.getElementById('templateProcessBtn');
        if (templateProcessBtn) {
            templateProcessBtn.disabled = true;
            templateProcessBtn.style.opacity = '0.5';
            templateProcessBtn.style.cursor = 'not-allowed';
        }
        
        // 모든 입력 폼 필드 초기화
        ['상품명', '연락처', '주소', '수량', '단가', '고객명'].forEach(field => {
            // 기존 직접 입력 폼
            const input = document.getElementById(`direct_${field}`);
            if (input) {
                input.value = '';
                input.style.borderColor = '#dee2e6';
                input.style.backgroundColor = '';
            }
            
            // 새로운 모드별 입력 폼들
            const directInput = document.getElementById(`direct_input_${field}`);
            if (directInput) {
                directInput.value = '';
                directInput.style.borderColor = '#dee2e6';
                directInput.style.backgroundColor = '';
            }
            
            const templateInput = document.getElementById(`template_${field}`);
            if (templateInput) {
                templateInput.value = '';
                templateInput.style.borderColor = '#dee2e6';
                templateInput.style.backgroundColor = '';
            }
        });
        
        // 파일 입력 초기화 (기본 + 모든 모드별)
        const fileInputElements = [
            'fileInputOrder',
            'fileInputSupplier',
            'fileInputOrderDirect',
            'fileInputSupplierDirect',
            'fileInputSupplierDirectMode',
            'fileInputOrderDefault',
            'fileInputSupplierDefault',
            'fileInputOrderSaved',
            'fileInputSupplierSaved'
        ];
        
        fileInputElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.value = '';
            }
        });
        
        // 버튼 상태 초기화
        updateGenerateOrderButton();
        
        // 이벤트 리스너 재설정
        setTimeout(() => {
            initializeApp();
        }, 100);
        
        showAlert('info', '🔄 모든 데이터가 초기화되었습니다. 처음부터 시작하세요.');
        
        console.log('🔄 전체 프로세스 재시작 완료');
    }
}

// 📋 개선된 직접 입력 필수 필드 검증
function validateDirectInputRequiredFields() {
    const requiredFields = [
        { id: 'direct_상품명', name: '상품명' },
        { id: 'direct_연락처', name: '연락처' },
        { id: 'direct_주소', name: '주소' }
    ];
    
    let isValid = true;
    const missingFields = [];
    
    requiredFields.forEach(field => {
        const input = document.getElementById(field.id);
        if (input) {
            const value = input.value.trim();
            if (!value) {
                isValid = false;
                missingFields.push(field.name);
                input.style.borderColor = '#dc3545';
                input.style.backgroundColor = '#fff5f5';
            } else {
                input.style.borderColor = '#28a745';
                input.style.backgroundColor = '#f8fff8';
            }
        }
    });
    
    if (!isValid) {
        showAlert('error', `다음 필수 항목을 입력해주세요: ${missingFields.join(', ')}`);
    }
    
    return isValid;
}

// 🎯 기본 발주서 템플릿 정의
function getDefaultSupplierTemplate() {
    return [
        '상품명',
        '수량',
        '단가',
        '고객명',
        '연락처',
        '주소',
        '총금액',
        '주문일자',
        '배송요청일',
        '비고'
    ];
}

// 🐛 오류 보고 창 열기
function openErrorReport() {
    try {
        // 새 창으로 오류 보고 사이트 열기
        const errorReportUrl = 'https://report-error-frontend.onrender.com/';
        const newWindow = window.open(
            errorReportUrl, 
            'ErrorReport', 
            'width=800,height=600,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no'
        );
        
        // 새 창이 차단되었는지 확인
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            // 팝업이 차단된 경우 대체 방법 제공
            showAlert('warning', '팝업이 차단되었습니다. 오류 신고 사이트로 직접 이동합니다.');
            window.location.href = errorReportUrl;
        } else {
            // 새 창에 포커스
            newWindow.focus();
        }
    } catch (error) {
        console.error('오류 보고 창 열기 실패:', error);
        showAlert('error', '오류 보고 사이트를 열 수 없습니다. 직접 이동합니다.');
        window.location.href = 'https://report-error-frontend.onrender.com/';
    }
}

// 📝 개선된 직접 입력 저장 함수
async function saveDirectInputImproved() {
    // 필수 필드 검증
    if (!validateDirectInputRequiredFields()) {
        return;
    }
    
    try {
        showProgress('직접 입력 데이터를 처리하고 있습니다...');
        
        // 입력 데이터 수집
        const inputData = {};
        ['상품명', '연락처', '주소', '수량', '단가', '고객명'].forEach(field => {
            const input = document.getElementById(`direct_${field}`);
            if (input && input.value.trim()) {
                inputData[field] = input.value.trim();
            }
        });
        
        // 총금액 계산 (수량과 단가가 있는 경우)
        if (inputData['수량'] && inputData['단가']) {
            const quantity = parseFloat(inputData['수량']) || 0;
            const price = parseFloat(inputData['단가']) || 0;
            inputData['총금액'] = (quantity * price).toLocaleString('ko-KR');
        }
        
        // 주문일자 추가
        inputData['주문일자'] = new Date().toLocaleDateString('ko-KR');
        
        hideProgress();
        
        // 발주서 파일이 업로드되었는지 확인
        if (currentSupplierFileId) {
            // 발주서 파일이 있는 경우 - AI 매핑 프로세스
            await processDirectInputWithAIMapping(inputData);
        } else {
            // 발주서 파일이 없는 경우 - 기본 템플릿 사용
            await processDirectInputWithDefaultTemplateImproved(inputData);
        }
        
    } catch (error) {
        hideProgress();
        console.error('직접 입력 저장 오류:', error);
        showAlert('error', '직접 입력 데이터 처리 중 오류가 발생했습니다.');
    }
}

// 🎯 개선된 기본 템플릿 처리 함수
async function processDirectInputWithDefaultTemplateImproved(inputData) {
    try {
        showLoading('기본 템플릿으로 발주서를 생성하고 있습니다...');
        
        // 기본 템플릿 필드 설정
        const defaultTemplate = getDefaultSupplierTemplate();
        
        // TARGET FIELDS 설정
        setupDefaultTargetFields(defaultTemplate);
        
        // 직접 입력 폼 숨기기
        document.getElementById('directInputStep').classList.add('hidden');
        
        // STEP 2 표시
        showStep(2);
        
        // 매핑 데이터 생성
        const mappedData = {};
        defaultTemplate.forEach(field => {
            if (inputData[field]) {
                mappedData[field] = inputData[field];
            }
        });
        
        // 전역 변수에 데이터 저장
        currentMapping = mappedData;
        orderFileHeaders = Object.keys(inputData);
        
        hideLoading();
        
        // 매핑이 완료되었지만 아직 저장되지 않음
        sessionStorage.setItem('mappingSaved', 'false');
        
        showAlert('success', '기본 템플릿으로 필드 매핑이 완료되었습니다. "매핑 저장" 버튼을 클릭한 후 발주서를 생성하세요.');
        
        // GENERATE ORDER 버튼 상태 업데이트 (비활성화됨)
        updateGenerateOrderButton();
        
    } catch (error) {
        hideLoading();
        console.error('기본 템플릿 처리 오류:', error);
        showAlert('error', '기본 템플릿 처리 중 오류가 발생했습니다.');
    }
}

// 🎯 기본 TARGET FIELDS 설정 함수
function setupDefaultTargetFields(defaultTemplate) {
    const targetFieldsContainer = document.getElementById('targetFields');
    if (!targetFieldsContainer) return;
    
    targetFieldsContainer.innerHTML = '';
    
    defaultTemplate.forEach(field => {
        const fieldElement = document.createElement('div');
        fieldElement.className = 'field-item';
        fieldElement.textContent = field;
        fieldElement.onclick = () => selectTargetField(fieldElement);
        targetFieldsContainer.appendChild(fieldElement);
    });
}

// 🔄 작업 모드 변경 함수
function changeWorkMode(mode) {
    // 모드 변경 시 모든 상태 초기화
    resetAllStatesOnModeChange();
    
    // 모든 모드 컨테이너 숨기기
    document.querySelectorAll('.mode-container').forEach(container => {
        container.classList.add('hidden');
    });
    
    // 선택된 모드에 따라 제목과 설명 변경
    const step1Title = document.getElementById('step1Title');
    const step1Description = document.getElementById('step1Description');
    
    switch(mode) {
        case 'fileUpload':
            document.getElementById('fileUploadMode').classList.remove('hidden');
            step1Title.textContent = 'STEP 1. 주문서 파일 업로드';
            step1Description.textContent = '다양한 형태의 주문서를 업로드하면 표준 발주서 양식으로 자동 변환됩니다.';
            break;
            
        case 'directInput':
            document.getElementById('directInputMode').classList.remove('hidden');
            step1Title.textContent = 'STEP 1. 주문서 직접 입력';
            step1Description.textContent = '주문 정보를 직접 입력하고 발주서 파일을 업로드하여 매핑합니다.';
            setupDirectInputModeEvents();
            break;
            
        case 'defaultTemplate':
            document.getElementById('defaultTemplateMode').classList.remove('hidden');
            step1Title.textContent = 'STEP 1. 기본 템플릿 사용';
            step1Description.textContent = '주문 정보를 입력하면 기본 발주서 템플릿으로 자동 변환됩니다.';
            break;
            
        case 'savedTemplate':
            document.getElementById('savedTemplateMode').classList.remove('hidden');
            step1Title.textContent = 'STEP 1. 저장 템플릿 사용';
            step1Description.textContent = '저장된 템플릿을 선택하고 주문서를 업로드하면 자동으로 발주서가 생성됩니다.';
            setupSavedTemplateModeEvents();
            loadTemplateList();
            break;
    }
    
    // 현재 모드 저장
    window.currentWorkMode = mode;
}

// 💾 저장 템플릿 모드 이벤트 설정
function setupSavedTemplateModeEvents() {
    const uploadAreaTemplateMode = document.getElementById('uploadAreaTemplateMode');
    const fileInputTemplateMode = document.getElementById('fileInputTemplateMode');
    
    if (uploadAreaTemplateMode && fileInputTemplateMode) {
        // 기존 이벤트 리스너 정리 (중복 방지)
        uploadAreaTemplateMode.onclick = null;
        uploadAreaTemplateMode.ondragover = null;
        uploadAreaTemplateMode.ondragleave = null;
        uploadAreaTemplateMode.ondrop = null;
        fileInputTemplateMode.onchange = null;
        
        // 새로운 클릭 핸들러 생성 (한 번만 실행되도록)
        const clickHandler = function(e) {
            // 이미 처리 중이면 무시
            if (isProcessing) {
                return;
            }
            
            try {
                // 임시로 보이게 만들고 클릭 (브라우저 보안 정책 우회)
                const originalStyle = {
                    position: fileInputTemplateMode.style.position,
                    opacity: fileInputTemplateMode.style.opacity,
                    zIndex: fileInputTemplateMode.style.zIndex
                };
                
                // 임시로 보이게 설정
                fileInputTemplateMode.style.position = 'static';
                fileInputTemplateMode.style.opacity = '1';
                fileInputTemplateMode.style.zIndex = '9999';
                
                // 클릭 시도
                fileInputTemplateMode.click();
                
                // 즉시 다시 숨기기
                setTimeout(() => {
                    fileInputTemplateMode.style.position = originalStyle.position || '';
                    fileInputTemplateMode.style.opacity = originalStyle.opacity || '';
                    fileInputTemplateMode.style.zIndex = originalStyle.zIndex || '';
                }, 10);
                
            } catch (error) {
                console.error('fileInputTemplateMode.click() 오류:', error);
            }
        };
        
        // 파일 선택 핸들러 생성 (한 번만 실행되도록)
        const changeHandler = function(e) {
            handleFileSelect(e, 'template-mode');
        };
        
        // 이벤트 리스너 등록
        uploadAreaTemplateMode.onclick = clickHandler;
        uploadAreaTemplateMode.addEventListener('dragover', handleDragOver);
        uploadAreaTemplateMode.addEventListener('dragleave', handleDragLeave);
        uploadAreaTemplateMode.addEventListener('drop', (e) => handleDrop(e, 'template-mode'));
        fileInputTemplateMode.onchange = changeHandler;
        
    } else {
        console.error('템플릿 모드 업로드 요소를 찾을 수 없습니다');
    }
}

// 📝 직접 입력 모드 이벤트 설정
function setupDirectInputModeEvents() {
    const uploadAreaSupplierDirectMode = document.getElementById('uploadAreaSupplierDirectMode');
    const fileInputSupplierDirectMode = document.getElementById('fileInputSupplierDirectMode');
    
    if (uploadAreaSupplierDirectMode && fileInputSupplierDirectMode) {
        console.log('🔧 직접 입력 모드 이벤트 리스너 설정 중...');
        
        // 기존 이벤트 리스너 정리 (중복 방지)
        uploadAreaSupplierDirectMode.onclick = null;
        uploadAreaSupplierDirectMode.ondragover = null;
        uploadAreaSupplierDirectMode.ondragleave = null;
        uploadAreaSupplierDirectMode.ondrop = null;
        fileInputSupplierDirectMode.onchange = null;
        
        // 새로운 클릭 핸들러 생성 (한 번만 실행되도록)
        const clickHandler = function(e) {
            // 이미 처리 중이면 무시
            if (isProcessing) {
                console.warn('⚠️ 파일 처리 중입니다. 클릭 무시됨');
                return;
            }
            
            console.log('📁 직접 입력 모드 업로드 영역 클릭됨');
            console.log('📋 fileInputSupplierDirectMode 요소:', fileInputSupplierDirectMode);
            
            try {
                console.log('🔄 fileInputSupplierDirectMode.click() 호출 시도...');
                
                // 임시로 보이게 만들고 클릭 (브라우저 보안 정책 우회)
                const originalStyle = {
                    position: fileInputSupplierDirectMode.style.position,
                    opacity: fileInputSupplierDirectMode.style.opacity,
                    zIndex: fileInputSupplierDirectMode.style.zIndex
                };
                
                // 임시로 보이게 설정
                fileInputSupplierDirectMode.style.position = 'static';
                fileInputSupplierDirectMode.style.opacity = '1';
                fileInputSupplierDirectMode.style.zIndex = '9999';
                
                // 클릭 시도
                fileInputSupplierDirectMode.click();
                
                // 즉시 다시 숨기기
                setTimeout(() => {
                    fileInputSupplierDirectMode.style.position = originalStyle.position || '';
                    fileInputSupplierDirectMode.style.opacity = originalStyle.opacity || '';
                    fileInputSupplierDirectMode.style.zIndex = originalStyle.zIndex || '';
                }, 10);
                
            } catch (error) {
                console.error('fileInputSupplierDirectMode.click() 오류:', error);
            }
        };
        
        // 파일 선택 핸들러 생성 (한 번만 실행되도록)
        const changeHandler = function(e) {
            handleFileSelect(e, 'supplier-direct');
        };
        
        // 이벤트 리스너 등록
        uploadAreaSupplierDirectMode.onclick = clickHandler;
        uploadAreaSupplierDirectMode.addEventListener('dragover', handleDragOver);
        uploadAreaSupplierDirectMode.addEventListener('dragleave', handleDragLeave);
        uploadAreaSupplierDirectMode.addEventListener('drop', (e) => handleDrop(e, 'supplier-direct'));
        fileInputSupplierDirectMode.onchange = changeHandler;
        
    } else {
        console.error('직접 입력 모드 업로드 요소를 찾을 수 없습니다');
    }
}

// 📝 직접 입력 모드 처리
async function processDirectInputMode() {
    // 필수 필드 검증
    const requiredFields = [
        { id: 'direct_input_상품명', name: '상품명' },
        { id: 'direct_input_연락처', name: '연락처' },
        { id: 'direct_input_주소', name: '주소' }
    ];
    
    let isValid = true;
    const missingFields = [];
    
    requiredFields.forEach(field => {
        const input = document.getElementById(field.id);
        if (input) {
            const value = input.value.trim();
            if (!value) {
                isValid = false;
                missingFields.push(field.name);
                input.style.borderColor = '#dc3545';
                input.style.backgroundColor = '#fff5f5';
            } else {
                input.style.borderColor = '#28a745';
                input.style.backgroundColor = '#f8fff8';
            }
        }
    });
    
    if (!isValid) {
        showAlert('error', `다음 필수 항목을 입력해주세요: ${missingFields.join(', ')}`);
        return;
    }
    
    try {
        showProgress('직접 입력 데이터를 처리하고 있습니다...');
        
        // 입력 데이터 수집 (값이 있는 것만)
        const inputData = {};
        ['상품명', '수량', '단가', '고객명', '연락처', '주소'].forEach(field => {
            const input = document.getElementById(`direct_input_${field}`);
            if (input && input.value.trim()) {
                inputData[field] = input.value.trim();
            }
        });
        
        // 총금액 계산
        if (inputData['수량'] && inputData['단가']) {
            const quantity = parseFloat(inputData['수량']) || 0;
            const price = parseFloat(inputData['단가']) || 0;
            inputData['총금액'] = (quantity * price).toLocaleString('ko-KR');
        }
        
        // 주문일자 추가
        inputData['주문일자'] = new Date().toLocaleDateString('ko-KR');
        
        // 전역 변수에 저장
        orderFileHeaders = Object.keys(inputData);
        
        // 발주서 파일이 없으면 기본 템플릿 자동 설정
        if (!currentSupplierFileId || supplierFileHeaders.length === 0) {
            supplierFileHeaders = getDefaultSupplierTemplate();
            console.log('📋 processDirectInputMode에서 기본 템플릿 자동 설정:', supplierFileHeaders);
            console.log('📋 supplierFileHeaders.length:', supplierFileHeaders.length);
        }
        
        hideProgress();
        
        // STEP 2로 이동
        showStep(2);
        setupMapping();
        
        // 자동 매칭 수행
        performAutoMatching();
        
        // 발주서 파일 상태에 따른 안내 메시지
        if (currentSupplierFileId && supplierFileHeaders.length > 0) {
            showAlert('success', '직접 입력이 완료되었습니다. 자동 매칭된 필드를 확인하고 추가 매핑을 설정하세요.');
        } else {
            showAlert('success', '직접 입력이 완료되었습니다. 기본 템플릿으로 자동 매칭되었습니다. 추가 매핑을 확인하세요.');
        }
        
    } catch (error) {
        hideProgress();
        console.error('직접 입력 모드 처리 오류:', error);
        showAlert('error', '직접 입력 데이터 처리 중 오류가 발생했습니다.');
    }
}

// 🎯 기본 템플릿 모드 처리
async function processDefaultTemplateMode() {
    // 필수 필드 검증
    const requiredFields = [
        { id: 'template_상품명', name: '상품명' },
        { id: 'template_연락처', name: '연락처' },
        { id: 'template_주소', name: '주소' }
    ];
    
    let isValid = true;
    const missingFields = [];
    
    requiredFields.forEach(field => {
        const input = document.getElementById(field.id);
        if (input) {
            const value = input.value.trim();
            if (!value) {
                isValid = false;
                missingFields.push(field.name);
                input.style.borderColor = '#dc3545';
                input.style.backgroundColor = '#fff5f5';
            } else {
                input.style.borderColor = '#28a745';
                input.style.backgroundColor = '#f8fff8';
            }
        }
    });
    
    if (!isValid) {
        showAlert('error', `다음 필수 항목을 입력해주세요: ${missingFields.join(', ')}`);
        return;
    }
    
    try {
        showProgress('기본 템플릿으로 데이터를 처리하고 있습니다...');
        
        // 입력 데이터 수집 (값이 있는 것만)
        const inputData = {};
        ['상품명', '수량', '단가', '고객명', '연락처', '주소'].forEach(field => {
            const input = document.getElementById(`template_${field}`);
            if (input && input.value.trim()) {
                inputData[field] = input.value.trim();
            }
        });
        
        // 총금액 계산
        if (inputData['수량'] && inputData['단가']) {
            const quantity = parseFloat(inputData['수량']) || 0;
            const price = parseFloat(inputData['단가']) || 0;
            inputData['총금액'] = (quantity * price).toLocaleString('ko-KR');
        }
        
        // 주문일자 추가
        inputData['주문일자'] = new Date().toLocaleDateString('ko-KR');
        
        // 기본 템플릿 필드 설정
        const defaultTemplate = getDefaultSupplierTemplate();
        
        // 전역 변수에 저장
        orderFileHeaders = Object.keys(inputData);
        supplierFileHeaders = defaultTemplate; // 기본 템플릿 사용
        
        hideProgress();
        
        // STEP 2로 이동
        showStep(2);
        setupMapping();
        
        // 자동 매핑 수행
        performAutoMatching();
        
        // 자동 매핑 완료 후 저장 필요 상태로 설정
        sessionStorage.setItem('mappingSaved', 'false');
        updateGenerateOrderButton();
        
        showAlert('success', '기본 템플릿으로 자동 매핑이 완료되었습니다! "매핑 저장" 버튼을 클릭한 후 발주서를 생성하세요.');
        
    } catch (error) {
        hideProgress();
        console.error('기본 템플릿 모드 처리 오류:', error);
        showAlert('error', '기본 템플릿 데이터 처리 중 오류가 발생했습니다.');
    }
}

// 📁 파일 처리 함수 수정 (모드별 처리)
async function processFileForMode(file, type) {
    const mode = window.currentWorkMode || 'fileUpload';
    
    // 파일 형식 검증 - 매우 구형 BIFF 포맷만 차단 (Excel 2016+ 호환)
    const isBiffBlocked = await checkIfBinaryXLS(file);
    if (isBiffBlocked) {
        const baseType = type.replace('-direct', '').replace('-mode', '');
        const typeText = baseType.includes('supplier') ? '발주서' : '주문서';
        
        showUploadResult(null, baseType, true, 
            `❌ 매우 구형 BIFF 포맷 Excel 파일은 지원되지 않습니다.<br><br>` +
            `📋 <strong>해결 방법:</strong><br>` +
            `1. Excel에서 해당 파일을 열어주세요<br>` +
            `2. "파일 → 다른 이름으로 저장" 메뉴를 선택하세요<br>` +
            `3. 파일 형식을 <strong>"Excel 통합 문서(*.xlsx)"</strong>로 변경하세요<br>` +
            `4. 변환된 .xlsx 파일을 다시 업로드해주세요<br><br>` +
            `💡 Excel 2016+ 에서 저장한 파일은 정상적으로 업로드됩니다.`
        );
        return;
    }
    
    // 허용되는 파일 형식 검증 (Excel, CSV 허용)
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const hasValidExtension = allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    
    if (!hasValidExtension) {
        const baseType = type.replace('-direct', '').replace('-mode', '');
        showUploadResult(null, baseType, true, 
            '❌ 지원하지 않는 파일 형식입니다.<br><br>' +
            '📋 <strong>지원 형식:</strong><br>' +
            '• Excel 파일(.xlsx, .xls) - Excel 2016+ 호환<br>' +
            '• CSV 파일(.csv)<br><br>' +
            '💡 매우 구형 BIFF 포맷 파일은 .xlsx로 변환 후 업로드해주세요.'
        );
        return;
    }
    
    // 파일 크기 검증 (10MB)
    if (file.size > 10 * 1024 * 1024) {
        const baseType = type.replace('-direct', '').replace('-mode', '');
        showUploadResult(null, baseType, true, 
            '❌ 파일 크기가 너무 큽니다.<br><br>' +
            '📋 <strong>파일 크기 제한:</strong><br>' +
            '• 최대 10MB까지 업로드 가능<br><br>' +
            '💡 파일 크기를 줄이거나 필요한 데이터만 포함하여 다시 업로드해주세요.'
        );
        return;
    }
    
    try {
        // 이미 처리 중인 경우 중단
        if (isProcessing) {
            const baseType = type.replace('-direct', '').replace('-mode', '');
            showUploadResult(null, baseType, true, 
                '⚠️ 이미 파일 처리가 진행 중입니다.<br><br>' +
                '💡 현재 다른 파일을 처리하고 있습니다. 잠시 후 다시 시도해주세요.'
            );
            return;
        }
        
        // 처리 상태 설정
        isProcessing = true;
        
        // 이전 요청 취소 (있는 경우)
        if (currentUploadController) {
            currentUploadController.abort();
        }
        
        // 새 AbortController 생성
        currentUploadController = new AbortController();
        
        const fileTypeText = type.includes('supplier') ? '발주서' : '주문서';
        showProgress(`${fileTypeText} 파일을 업로드하고 있습니다...`);
        
        const formData = new FormData();
        formData.append('orderFile', file);
        
        // 파일 타입 설정 (템플릿 모드는 주문서 파일)
        let fileType;
        if (type === 'template-mode') {
            fileType = 'order'; // 템플릿 모드에서는 주문서 파일 업로드
        } else if (type.includes('supplier')) {
            fileType = 'supplier';
        } else {
            fileType = 'order';
        }
        
        formData.append('fileType', fileType);
        
        const response = await fetch('/api/orders/upload', {
            method: 'POST',
            body: formData,
            signal: currentUploadController.signal
        });
        
        // 45초 타임아웃 설정 (render 환경 최적화)
        const timeoutId = setTimeout(() => {
            if (currentUploadController && !currentUploadController.signal.aborted) {
                currentUploadController.abort();
                showAlert('error', '업로드 시간이 초과되었습니다. render 서버 처리 지연이 발생할 수 있습니다. 잠시 후 다시 시도해주세요.');
            }
        }, 45000);
        
        const result = await response.json();
        
        // 타임아웃 정리
        clearTimeout(timeoutId);
        
        hideProgress();
        
        if (result.success) {
            // 모드별 처리
            if (type === 'supplier-direct') {
                currentSupplierFileId = result.fileId;
                supplierFileHeaders = result.headers;
                
                const uploadResult = document.getElementById('uploadResultSupplierDirectMode');
                const uploadAlert = document.getElementById('uploadAlertSupplierDirectMode');
                
                if (uploadResult && uploadAlert) {
                    uploadResult.classList.remove('hidden');
                    uploadAlert.innerHTML = `
                        <div class="alert alert-success">
                            ✅ 발주서 파일이 성공적으로 업로드되었습니다!<br>
                            <strong>파일명:</strong> ${result.fileName}<br>
                            <strong>컬럼 수:</strong> ${result.headers.length}개
                        </div>
                    `;
                }
                
                showAlert('success', '발주서 파일이 업로드되었습니다. 주문 정보를 입력 후 완료 버튼을 클릭하세요.');
                 
                // 이미 주문 정보가 입력되어 있으면 매핑 갱신 및 자동 매칭
                if (orderFileHeaders.length > 0) {
                    setupMapping();
                    performAutoMatching();
                    console.log('🔄 발주서 파일 업로드 후 매핑 재설정 및 자동 매칭 완료');
                }
                
            } else if (type === 'template-mode') {
                console.log('📋 템플릿 모드 파일 업로드 완료:', {
                    type: type,
                    fileType: fileType,
                    resultFileId: result.fileId,
                    fileName: result.fileName
                });
                
                currentOrderFileId = result.fileId;
                orderFileHeaders = result.headers;
                
                console.log('✅ 템플릿 모드 변수 설정 완료:', {
                    currentOrderFileId: currentOrderFileId,
                    orderFileHeaders: orderFileHeaders.length
                });
                
                const uploadResult = document.getElementById('uploadResultTemplateMode');
                const uploadAlert = document.getElementById('uploadAlertTemplateMode');
                
                if (uploadResult && uploadAlert) {
                    uploadResult.classList.remove('hidden');
                    uploadAlert.innerHTML = `
                        <div class="alert alert-success">
                            ✅ 주문서 파일이 성공적으로 업로드되었습니다!<br>
                            <strong>파일명:</strong> ${result.fileName}<br>
                            <strong>컬럼 수:</strong> ${result.headers.length}개<br>
                            <strong>데이터 행:</strong> ${result.validation ? result.validation.validRows : '확인 중'}개
                        </div>
                    `;
                }
                
                // 템플릿 처리 버튼 상태 업데이트
                updateTemplateProcessButton();
                
                showAlert('success', '주문서 파일이 업로드되었습니다. 템플릿을 선택하고 자동 변환을 시작하세요.');
            }
            
        } else {
            let errorMessage = result.error || '파일 업로드에 실패했습니다.';
            
            // 매우 구형 BIFF 포맷 파일 오류인 경우 특별 안내
            if (result.fileType === 'binary-xls' || errorMessage.includes('구형 BIFF 포맷')) {
                errorMessage = '❌ 매우 구형 BIFF 포맷 Excel 파일은 지원되지 않습니다.<br><br>' +
                              '📋 <strong>해결 방법:</strong><br>' +
                              '1. Excel에서 해당 파일을 열어주세요<br>' +
                              '2. "파일 → 다른 이름으로 저장" 메뉴를 선택하세요<br>' +
                              '3. 파일 형식을 <strong>"Excel 통합 문서(*.xlsx)"</strong>로 변경하세요<br>' +
                              '4. 변환된 .xlsx 파일을 다시 업로드해주세요<br><br>' +
                              '💡 Excel 2016+ 에서 저장한 파일은 정상적으로 업로드됩니다.';
            }
            // 일반 .xls 파일 오류인 경우 특별 안내
            else if (file.name.toLowerCase().endsWith('.xls') && errorMessage.includes('Excel 파일')) {
                errorMessage = `${errorMessage}\n\n💡 해결 방법:\n1. Excel에서 파일을 열고 "파일 > 다른 이름으로 저장" 선택\n2. 파일 형식을 "Excel 통합 문서 (*.xlsx)" 선택\n3. 새로 저장된 .xlsx 파일을 업로드해주세요`;
            }
            
            // 해당 업로드 영역에 오류 메시지 표시
            const baseType = type.replace('-direct', '').replace('-mode', '');
            showUploadResult(null, baseType, true, errorMessage);
        }
        
        // 처리 완료 후 상태 초기화
        isProcessing = false;
        currentUploadController = null;
        
    } catch (error) {
        hideProgress();
        console.error('업로드 오류:', error);
        
        // 타임아웃 정리 (존재하는 경우)
        if (typeof timeoutId !== 'undefined') {
            clearTimeout(timeoutId);
        }
        
        // 처리 상태 초기화
        isProcessing = false;
        currentUploadController = null;
        
        // 요청 취소 오류인 경우 특별 처리
        if (error.name === 'AbortError') {
            console.log('업로드 요청이 취소되었습니다.');
            showAlert('info', '업로드가 취소되었습니다.');
            return;
        }
        
        // catch 블록의 오류도 해당 업로드 영역에 표시
        const baseType = type.replace('-direct', '').replace('-mode', '');
        showUploadResult(null, baseType, true, '파일 업로드 중 오류가 발생했습니다.');
    }
}

// 🔄 모드 변경 시 모든 상태 초기화 함수
function resetAllStatesOnModeChange() {
    // 전역 변수 초기화
    currentOrderFileId = null;
    currentSupplierFileId = null;
    currentMapping = {};
    generatedFileName = null;
    displayFileName = null;
    orderFileHeaders = [];
    supplierFileHeaders = [];
    
    // 세션 스토리지 초기화
    sessionStorage.setItem('mappingSaved', 'false');
    
    // 펜딩 데이터 정리
    delete window.pendingDirectInputData;
    delete window.pendingMappedData;
    delete window.pendingAIMappings;
    
    // 모든 스텝 초기화 (2, 3, 4단계 숨기기)
    resetAllSteps();
    
    // 업로드 결과 초기화
    const uploadResults = [
        'uploadResultOrder',
        'uploadResultSupplier', 
        'uploadResultSupplierDirectMode'
    ];
    
    uploadResults.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.classList.add('hidden');
    });
    
    // 알림 영역 초기화
    const alerts = [
        'uploadAlert',
        'uploadAlertOrder',
        'uploadAlertSupplier',
        'uploadAlertSupplierDirectMode'
    ];
    
    alerts.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.innerHTML = '';
    });
    
    // 모든 입력 폼 필드 초기화
    ['상품명', '연락처', '주소', '수량', '단가', '고객명'].forEach(field => {
        // 기존 직접 입력 폼
        const input = document.getElementById(`direct_${field}`);
        if (input) {
            input.value = '';
            input.style.borderColor = '#dee2e6';
            input.style.backgroundColor = '';
        }
        
        // 새로운 모드별 입력 폼들
        const directInput = document.getElementById(`direct_input_${field}`);
        if (directInput) {
            directInput.value = '';
            directInput.style.borderColor = '#dee2e6';
            directInput.style.backgroundColor = '';
        }
        
        const templateInput = document.getElementById(`template_${field}`);
        if (templateInput) {
            templateInput.value = '';
            templateInput.style.borderColor = '#dee2e6';
            templateInput.style.backgroundColor = '';
        }
    });
    
    // 파일 입력 초기화
    const fileInputs = [
        'fileInputOrder',
        'fileInputSupplier',
        'fileInputSupplierDirectMode'
    ];
    
    fileInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    
    // 생성 결과 및 이메일 관련 초기화
    const generateResult = document.getElementById('generateResult');
    const emailResult = document.getElementById('emailResult');
    if (generateResult) generateResult.innerHTML = '';
    if (emailResult) emailResult.innerHTML = '';
    
    // 버튼 상태 초기화
    updateGenerateOrderButton();
    
    // 진행률 숨기기
    hideProgress();
    
    console.log('🔄 모드 변경으로 인한 상태 초기화 완료');
}

// 🤖 자동 필드 매칭 함수
function performAutoMatching() {
    console.log('🤖 자동 매칭 시작');
    console.log('- 소스 필드:', orderFileHeaders);
    console.log('- 타겟 필드:', supplierFileHeaders);
    
    let matchedCount = 0;
    const matchedFields = [];
    
    // 소스 필드와 타겟 필드 중 이름이 동일한 것들을 찾아서 매핑
    orderFileHeaders.forEach(sourceField => {
        // 타겟 필드에서 동일한 이름을 찾기 (완전 일치 또는 "원본 - 타겟" 형태 매칭)
        const matchingTargetField = supplierFileHeaders.find(targetField => {
            // 1. 완전 일치
            if (sourceField === targetField) {
                return true;
            }
            
            // 2. "원본 - 타겟" 형태에서 타겟 부분이 일치하는 경우
            if (targetField.includes(' - ')) {
                const targetPart = targetField.split(' - ')[1]; // "상품명 - 상품명" → "상품명"
                if (sourceField === targetPart) {
                    return true;
                }
            }
            
            // 3. 소스 필드가 타겟 필드에 포함되어 있는 경우 (유사 매칭)
            if (targetField.includes(sourceField) || sourceField.includes(targetField)) {
                return true;
            }
            
            return false;
        });
        
        if (matchingTargetField) {
            // 매핑 정보 저장
            currentMapping[matchingTargetField] = sourceField;
            matchedFields.push({ source: sourceField, target: matchingTargetField });
            matchedCount++;
            
            console.log(`✅ 자동 매칭: ${sourceField} → ${matchingTargetField}`);
        }
    });
    
    // UI 업데이트: 매칭된 필드들을 시각적으로 표시
    updateMappingUI(matchedFields);
    
    console.log(`🎯 자동 매칭 완료: ${matchedCount}개 필드 매칭됨`);
    
    if (matchedCount > 0) {
        // 자동 매핑은 완료되었지만 아직 저장되지 않음
        sessionStorage.setItem('mappingSaved', 'false');
        updateGenerateOrderButton();
        
        console.log(`📋 ${matchedCount}개 필드가 자동으로 매칭되었습니다: ${matchedFields.map(m => m.source).join(', ')}`);
    }
}

// 🎨 매핑 UI 업데이트 함수
function updateMappingUI(matchedFields) {
    const sourceFieldsContainer = document.getElementById('sourceFields');
    const targetFieldsContainer = document.getElementById('targetFields');
    
    matchedFields.forEach(({ source, target }) => {
        // 타겟 필드 시각적 업데이트
        const targetElements = targetFieldsContainer.querySelectorAll('.field-item');
        targetElements.forEach(element => {
            if (element.dataset.target === target) {
                element.style.background = '#28a745';
                element.style.color = 'white';
                element.innerHTML = `${target} ← ${source}`;
            }
        });
        
        // 소스 필드에서 매칭된 필드 제거
        const sourceElements = sourceFieldsContainer.querySelectorAll('.field-item');
        sourceElements.forEach(element => {
            if (element.dataset.source === source) {
                element.remove();
            }
        });
    });
}

// 🤖 AI 기능 버튼 상태 업데이트
function updateAIFeatureButtons(hasApiKey) {
    const aiMappingBtn = document.querySelector('button[onclick="aiAutoMapping()"]');
    
    if (aiMappingBtn) {
        if (hasApiKey) {
            aiMappingBtn.style.opacity = '1';
            aiMappingBtn.style.cursor = 'pointer';
            aiMappingBtn.disabled = false;
            aiMappingBtn.title = 'AI가 자동으로 필드를 매핑합니다';
        } else {
            aiMappingBtn.style.opacity = '0.6';
            aiMappingBtn.style.cursor = 'not-allowed';
            aiMappingBtn.disabled = false; // 클릭은 가능하지만 경고 메시지 표시
            aiMappingBtn.title = 'OpenAI API 키가 필요합니다. 클릭하면 안내를 확인할 수 있습니다.';
        }
    }
}

// 🔐 인증 상태 표시 (개선된 버전)
function addAuthenticationIndicator(authenticatedAt, isAdmin, username, hasApiKey) {
    // 기존 표시기 제거
    const existingIndicator = document.querySelector('.auth-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    const indicator = document.createElement('div');
    indicator.className = 'auth-indicator';
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: ${hasApiKey ? 'linear-gradient(135deg, #28a745 0%, #20c997 100%)' : 'linear-gradient(135deg, #6c757d 0%, #495057 100%)'};
        color: white;
        padding: 8px 15px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
        user-select: none;
        cursor: pointer;
        transition: all 0.3s ease;
    `;
    
    const statusIcon = hasApiKey ? '🤖' : '📋';
    const statusText = hasApiKey ? 'AI 기능 사용 가능' : '수동/템플릿 모드';
    const userInfo = isAdmin ? ` (관리자${username ? `: ${username}` : ''})` : '';
    
    indicator.innerHTML = `${statusIcon} ${statusText}${userInfo}`;
    
    // 클릭 시 API 키 설정 안내 또는 상태 정보 표시
    indicator.addEventListener('click', () => {
        if (hasApiKey) {
            showAlert('info', `✅ OpenAI API 키가 설정되어 있습니다.\n🤖 AI 자동 매핑 기능을 사용할 수 있습니다.\n📅 인증 시간: ${new Date(authenticatedAt).toLocaleString()}`);
        } else {
            showAlert('info', `📋 현재 수동/템플릿 모드로 사용 중입니다.\n\n🤖 AI 자동 매핑을 사용하려면:\n1. 우측 상단 "API 키 설정" 클릭\n2. OpenAI API 키 입력\n\n💡 API 키 없이도 모든 핵심 기능을 사용할 수 있습니다!`);
        }
    });
    
    document.body.appendChild(indicator);
    
    // API 키 설정 버튼 추가
    if (!hasApiKey) {
        addApiKeySetupButton();
    }
}

// 🔑 API 키 설정 버튼 추가
function addApiKeySetupButton() {
    // 기존 버튼 제거
    const existingBtn = document.querySelector('.api-key-setup-btn');
    if (existingBtn) {
        existingBtn.remove();
    }
    
    const setupBtn = document.createElement('button');
    setupBtn.className = 'api-key-setup-btn';
    setupBtn.style.cssText = `
        position: fixed;
        top: 50px;
        right: 10px;
        background: linear-gradient(135deg, #6f42c1 0%, #5a32a3 100%);
        color: white;
        border: none;
        padding: 8px 15px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 999;
        cursor: pointer;
        transition: all 0.3s ease;
    `;
    
    setupBtn.innerHTML = '🔑 API 키 설정';
    setupBtn.title = 'OpenAI API 키를 설정하여 AI 자동 매핑 기능을 사용하세요';
    
    setupBtn.addEventListener('click', () => {
        window.location.href = '/auth.html';
    });
    
    setupBtn.addEventListener('mouseenter', () => {
        setupBtn.style.transform = 'scale(1.05)';
    });
    
    setupBtn.addEventListener('mouseleave', () => {
        setupBtn.style.transform = 'scale(1)';
    });
    
    document.body.appendChild(setupBtn);
}

// 🔗 ===== WEBHOOK 관리 기능 ===== 🔗

// 📋 클립보드에 복사
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent || element.value;
    
    navigator.clipboard.writeText(text).then(() => {
        showAlert('success', '📋 클립보드에 복사되었습니다!');
        
        // 복사 버튼 시각적 피드백
        const copyBtn = element.nextElementSibling;
        if (copyBtn && copyBtn.classList.contains('copy-btn')) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅';
            copyBtn.style.background = '#28a745';
            
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '#6c757d';
            }, 2000);
        }
    }).catch(err => {
        console.error('클립보드 복사 실패:', err);
        showAlert('error', '클립보드 복사에 실패했습니다.');
    });
}

// 🔍 Webhook API 상태 확인
async function checkWebhookStatus() {
    const statusIndicator = document.getElementById('apiKeyIndicator');
    const statusText = document.getElementById('apiKeyText');
    const statusContainer = document.getElementById('apiKeyStatus');
    
    try {
        // 로딩 상태
        statusIndicator.textContent = '⏳';
        statusText.textContent = 'API 상태 확인 중...';
        statusContainer.style.borderLeftColor = '#ffc107';
        
        console.log('🔍 Webhook API 상태 확인 중...');
        
        // 환경변수에서 API 키가 설정되어 있는지 서버에 확인
        const response = await fetch('/api/webhook/status', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer dummy-key-for-check` // 더미 키로 테스트
            }
        });
        
        if (response.status === 500) {
            // API 키가 서버에 설정되지 않음
            statusIndicator.textContent = '❌';
            statusText.textContent = 'WEBHOOK_API_KEY가 서버에 설정되지 않았습니다.';
            statusContainer.style.borderLeftColor = '#dc3545';
            showAlert('warning', '⚠️ WEBHOOK_API_KEY가 환경변수에 설정되지 않았습니다.\n\n서버 관리자가 다음을 설정해야 합니다:\nWEBHOOK_API_KEY=your-secure-api-key');
        } else if (response.status === 401) {
            // API 키는 설정되어 있지만 인증 실패 (정상)
            statusIndicator.textContent = '✅';
            statusText.textContent = 'Webhook API가 정상 작동 중입니다. (API 키 설정됨)';
            statusContainer.style.borderLeftColor = '#28a745';
            showAlert('success', '✅ Webhook API가 정상 작동 중입니다!\n\n런모아 담당자에게 API 정보를 전달할 수 있습니다.');
        } else {
            const result = await response.json();
            if (result.success) {
                statusIndicator.textContent = '✅';
                statusText.textContent = `Webhook API 정상 작동 중 (v${result.version})`;
                statusContainer.style.borderLeftColor = '#28a745';
                showAlert('success', '✅ Webhook API가 정상 작동 중입니다!');
            } else {
                throw new Error(result.error || '알 수 없는 오류');
            }
        }
        
    } catch (error) {
        console.error('❌ Webhook 상태 확인 실패:', error);
        statusIndicator.textContent = '❌';
        statusText.textContent = 'API 상태 확인 실패';
        statusContainer.style.borderLeftColor = '#dc3545';
        showAlert('error', '❌ Webhook API 상태 확인에 실패했습니다.\n\n' + error.message);
    }
}

// 🧪 Webhook API 기본 테스트
async function testWebhookAPI() {
    try {
        showLoading('Webhook API 연결 테스트 중...');
        
        // 기본 연결 테스트 (인증 없이)
        const response = await fetch('/api/webhook/status');
        
        hideLoading();
        
        if (response.status === 500) {
            showAlert('warning', '⚠️ WEBHOOK_API_KEY가 환경변수에 설정되지 않았습니다.\n\n서버 관리자에게 문의하세요.');
        } else if (response.status === 401) {
            showAlert('info', '🔐 Webhook API 엔드포인트가 정상적으로 응답합니다.\n\n실제 테스트를 위해서는 유효한 API 키가 필요합니다.');
        } else {
            const result = await response.json();
            showAlert('success', '✅ Webhook API 연결 테스트 성공!\n\n' + JSON.stringify(result, null, 2));
        }
        
    } catch (error) {
        hideLoading();
        console.error('❌ Webhook API 테스트 실패:', error);
        showAlert('error', '❌ Webhook API 테스트에 실패했습니다.\n\n' + error.message);
    }
}

// 📤 테스트 주문 전송
async function sendTestOrder() {
    const resultDiv = document.getElementById('webhookTestResult');
    const resultContent = document.getElementById('testResultContent');
    
    try {
        // 테스트 데이터 수집
        const testData = {
            order_id: document.getElementById('testOrderId').value,
            customer_name: document.getElementById('testCustomerName').value,
            customer_phone: '010-1234-5678',
            shipping_address: '서울시 테스트구 테스트로 123',
            products: [
                {
                    product_name: document.getElementById('testProductName').value,
                    quantity: parseInt(document.getElementById('testQuantity').value) || 1,
                    unit_price: parseInt(document.getElementById('testUnitPrice').value) || 10000,
                    total_price: (parseInt(document.getElementById('testQuantity').value) || 1) * (parseInt(document.getElementById('testUnitPrice').value) || 10000)
                }
            ],
            total_amount: (parseInt(document.getElementById('testQuantity').value) || 1) * (parseInt(document.getElementById('testUnitPrice').value) || 10000),
            order_date: new Date().toISOString()
        };
        
        console.log('📤 테스트 주문 데이터:', testData);
        
        showLoading('테스트 주문을 전송하고 있습니다...');
        
        // API 키 입력 요청
        const apiKey = prompt('🔐 Webhook API 키를 입력하세요:\n\n(실제 운영 환경에서는 런모아 플랫폼이 자동으로 전송합니다)');
        
        if (!apiKey) {
            hideLoading();
            showAlert('info', '⚠️ API 키가 입력되지 않아 테스트를 취소합니다.');
            return;
        }
        
        // Webhook API 호출
        const response = await fetch('/api/webhook/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(testData)
        });
        
        const result = await response.json();
        
        hideLoading();
        
        // 결과 표시
        resultContent.textContent = JSON.stringify(result, null, 2);
        resultDiv.style.display = 'block';
        
        if (result.success) {
            showAlert('success', `✅ 테스트 주문 처리 성공!\n\n주문번호: ${result.order_id}\n생성된 파일: ${result.generated_file}\n이메일 전송: ${result.email_sent ? '성공' : '실패'}\n처리 시간: ${result.processing_time}`);
        } else {
            showAlert('error', `❌ 테스트 주문 처리 실패:\n\n${result.error}\n\n상세 정보: ${result.details || 'N/A'}`);
        }
        
        // 결과 영역으로 스크롤
        resultDiv.scrollIntoView({ behavior: 'smooth' });
        
    } catch (error) {
        hideLoading();
        console.error('❌ 테스트 주문 전송 실패:', error);
        showAlert('error', '❌ 테스트 주문 전송 중 오류가 발생했습니다.\n\n' + error.message);
        
        // 오류 결과도 표시
        resultContent.textContent = `오류: ${error.message}\n\n스택: ${error.stack}`;
        resultDiv.style.display = 'block';
    }
}

// 🌐 현재 환경에 맞는 Webhook URL 설정
function updateWebhookUrl() {
    const webhookUrlElement = document.getElementById('webhookUrl');
    if (webhookUrlElement) {
        const currentOrigin = window.location.origin;
        const webhookUrl = `${currentOrigin}/api/webhook/orders`;
        webhookUrlElement.textContent = webhookUrl;
        
        console.log('🔗 Webhook URL 설정 완료:', webhookUrl);
        
        // 환경 표시
        const isLocalhost = currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1');
        if (isLocalhost) {
            webhookUrlElement.style.background = '#e3f2fd';
            webhookUrlElement.style.color = '#1976d2';
            webhookUrlElement.title = '로컬 개발 환경';
        } else {
            webhookUrlElement.style.background = '#e8f5e8';
            webhookUrlElement.style.color = '#2e7d32';
            webhookUrlElement.title = '프로덕션 환경';
        }
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 1. URL 설정 (즉시)
    updateWebhookUrl();
    
    // 2. 관리자 권한 확인 및 Webhook 섹션 표시 여부 결정
    checkAdminAccessForWebhook();
    
    // 3. Webhook 상태 확인 (2초 후, 관리자인 경우에만)
    setTimeout(() => {
        const webhookSection = document.getElementById('webhookManagement');
        if (webhookSection && webhookSection.style.display !== 'none') {
            checkWebhookStatus();
        }
    }, 2000);
});

// 🔐 관리자 권한 확인 및 Webhook 섹션 표시
async function checkAdminAccessForWebhook() {
    try {
        console.log('🔍 관리자 권한 확인 중...');
        
        // 인증 상태 확인
        const response = await fetch('/api/auth/check');
        const authStatus = await response.json();
        
        const webhookSection = document.getElementById('webhookManagement');
        
        if (authStatus.showWebhookManagement) {
            // 관리자 + 개발환경 (또는 강제 표시) → Webhook 관리 표시
            console.log('✅ Webhook 관리 섹션 표시 허용:', {
                isAdmin: authStatus.isAdmin,
                isDevelopment: authStatus.isDevelopment,
                showWebhookManagement: authStatus.showWebhookManagement
            });
            webhookSection.style.display = 'block';
        } else {
            // 프로덕션 환경 또는 일반 사용자 → Webhook 관리 완전 숨김 (보안)
            console.log('🔒 Webhook 관리 섹션 숨김 (보안):', {
                isAdmin: authStatus.isAdmin,
                isDevelopment: authStatus.isDevelopment,
                reason: authStatus.isAdmin ? '프로덕션 환경' : '관리자 권한 없음'
            });
            webhookSection.style.display = 'none';
        }
        
    } catch (error) {
        console.error('❌ 관리자 권한 확인 실패:', error);
        // 오류 시 보안상 숨김
        const webhookSection = document.getElementById('webhookManagement');
        if (webhookSection) {
            webhookSection.style.display = 'none';
        }
    }
}

