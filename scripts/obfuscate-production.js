const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 난독화할 파일 목록
const filesToObfuscate = [
  'public/app.js'
];

// 운영 환경용 강화 난독화 옵션
const productionObfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3, // 성능 고려하여 낮춤
  numbersToExpressions: true,
  simplify: true,
  stringArrayShuffle: true,
  splitStrings: false, // 호환성을 위해 비활성화
  stringArrayThreshold: 0.8,
  stringArray: true,
  rotateStringArray: true,
  selfDefending: true, // 운영에서는 활성화
  debugProtection: true, // 운영에서는 활성화
  debugProtectionInterval: 4000,
  disableConsoleOutput: true, // 운영에서는 콘솔 비활성화
  identifierNamesGenerator: 'mangled', // 더 짧은 변수명
  renameGlobals: false,
  transformObjectKeys: false,
  deadCodeInjection: true, // 가짜 코드 삽입
  deadCodeInjectionThreshold: 0.2,
  // 보존할 함수명 (필수만 최소화)
  reservedNames: [
    '^console$', '^alert$', '^confirm$',
    '^fetch$', '^XMLHttpRequest$', '^FormData$',
    '^document$', '^window$', '^location$',
    '^addEventListener$', '^removeEventListener$',
    '^getElementById$', '^querySelector$', '^querySelectorAll$',
    '^setTimeout$', '^setInterval$', '^clearTimeout$', '^clearInterval$',
    '^JSON$', '^Date$', '^Array$', '^Object$', '^Promise$'
  ]
};

console.log('운영용 JavaScript 코드 강화 난독화 시작...');

filesToObfuscate.forEach(filePath => {
  try {
    // 원본 파일 읽기
    const originalCode = fs.readFileSync(filePath, 'utf8');
    
    // 백업 파일 생성
    const backupPath = filePath.replace('.js', '.production-backup.js');
    fs.writeFileSync(backupPath, originalCode);
    console.log(`운영용 백업 생성: ${backupPath}`);
    
    // 난독화 실행
    const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, productionObfuscationOptions);
    
    // 난독화된 코드 저장
    fs.writeFileSync(filePath, obfuscationResult.getObfuscatedCode());
    
    console.log(`운영용 난독화 완료: ${filePath}`);
    console.log(`   원본 크기: ${(originalCode.length / 1024).toFixed(2)} KB`);
    console.log(`   난독화 크기: ${(obfuscationResult.getObfuscatedCode().length / 1024).toFixed(2)} KB`);
    
  } catch (error) {
    console.error(`운영용 난독화 실패 (${filePath}):`, error.message);
  }
});

console.log('운영용 난독화 작업 완료!');
console.log('이 설정은 디버깅을 차단하고 콘솔을 비활성화합니다.');
console.log('복구 방법: npm run restore'); 