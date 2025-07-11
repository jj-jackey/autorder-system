const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 난독화할 파일 목록
const filesToObfuscate = [
  'public/app.js'
];

// 난독화 옵션
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  numbersToExpressions: true,
  simplify: true,
  stringArrayShuffle: true,
  splitStrings: true,
  stringArrayThreshold: 0.8,
  stringArray: true,
  rotateStringArray: true,
  selfDefending: true,
  debugProtection: true,
  debugProtectionInterval: 2000,
  disableConsoleOutput: false, // 개발시에는 false, 운영시에는 true
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  reservedNames: ['^console$', '^alert$', '^confirm$'], // 보존할 함수명
};

console.log('🔒 JavaScript 코드 난독화 시작...');

filesToObfuscate.forEach(filePath => {
  try {
    // 원본 파일 읽기
    const originalCode = fs.readFileSync(filePath, 'utf8');
    
    // 백업 파일 생성
    const backupPath = filePath.replace('.js', '.original.js');
    fs.writeFileSync(backupPath, originalCode);
    console.log(`📋 백업 생성: ${backupPath}`);
    
    // 난독화 실행
    const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, obfuscationOptions);
    
    // 난독화된 코드 저장
    fs.writeFileSync(filePath, obfuscationResult.getObfuscatedCode());
    
    console.log(`✅ 난독화 완료: ${filePath}`);
    console.log(`   원본 크기: ${(originalCode.length / 1024).toFixed(2)} KB`);
    console.log(`   난독화 크기: ${(obfuscationResult.getObfuscatedCode().length / 1024).toFixed(2)} KB`);
    
  } catch (error) {
    console.error(`❌ 난독화 실패 (${filePath}):`, error.message);
  }
});

console.log('🎉 난독화 작업 완료!');
console.log('💡 원본 복구 방법: .original.js 파일을 .js로 이름 변경'); 