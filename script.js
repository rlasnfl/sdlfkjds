// 전체 앱 동작을 담당하는 스크립트입니다.
// - Web Speech API로 한국어 음성 인식
// - 키워드 기반 위험도 분석 (점수 합산, 최대 100)
// - Chart.js로 실시간 막대그래프 업데이트
// - 게이지, 하이라이트, TTS 지원

// ---------------------------
// 설정: 키워드와 점수 매핑
// ---------------------------
const KEYWORDS = [
  { words: ['검찰', '경찰'], label: '검찰 사칭', score: 25, key: 'prosecutor' },
  { words: ['계좌', '송금'], label: '계좌 요구', score: 20, key: 'account' },
  { words: ['긴급', '즉시'], label: '긴급 압박', score: 15, key: 'urgent' },
  { words: ['개인정보'], label: '개인정보 요구', score: 35, key: 'personal' },
  { words: ['앱 설치'], label: '앱 설치 유도', score: 40, key: 'install' }
];

// 최대 점수
const MAX_SCORE = 100;

// 상태 변수
let totalScore = 0;
let categoryCounts = { prosecutor:0, account:0, urgent:0, personal:0, install:0 };

// DOM 요소 캐시
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const transcriptOutput = document.getElementById('transcriptOutput');
const scoreValue = document.getElementById('scoreValue');
const riskText = document.getElementById('riskText');
const gaugeFill = document.getElementById('gaugeFill');
const gaugePercent = document.getElementById('gaugePercent');
const warningMsg = document.getElementById('warningMsg');
const keywordList = document.getElementById('keywordList');
const listeningIndicator = document.getElementById('listeningIndicator');
const statusText = document.getElementById('statusText');
const speakBtn = document.getElementById('speakBtn');

// Chart.js 초기화
const ctx = document.getElementById('riskChart').getContext('2d');
const chartLabels = KEYWORDS.map(k => k.label);
const chartData = [0,0,0,0,0];
const riskChart = new Chart(ctx, {
  type: 'bar',
  data: {
    labels: chartLabels,
    datasets: [{
      label: '감지 횟수',
      data: chartData,
      backgroundColor: ['#ff6b6b', '#ff7b7b', '#ff8b8b', '#ff9999', '#ff4d4d'],
      borderRadius: 8
    }]
  },
  options: {
    animation: { duration: 600 },
    scales: {
      y: { beginAtZero: true, ticks: { precision:0 } }
    },
    plugins: { legend: { display: false } }
  }
});

// 음성 인식 객체 (브라우저 호환성 처리)
let recognition;
let listening = false;
let finalTranscript = ''; // 최종 확정된 문장들만 누적

if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
  statusText.textContent = '음성 인식이 지원되지 않는 브라우저입니다.';
  startBtn.disabled = true;
  stopBtn.disabled = true;
} else {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR';            // 한국어
  recognition.interimResults = true;     // 실시간 중간 결과 표시
  recognition.continuous = true;         // 연속 인식

  // 결과 이벤트 처리
  recognition.onresult = (event) => {
    // event.results는 누적된 결과들의 리스트
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        // 확정된 말은 최종 텍스트로 처리
        handleFinalTranscript(transcript.trim());
      } else {
        interim += transcript;
      }
    }

    // 화면에 실시간(임시+최종) 텍스트 표시, 키워드 하이라이트 적용
    const displayText = (finalTranscript + ' ' + interim).trim();
    transcriptOutput.innerHTML = highlightKeywords(escapeHtml(displayText));
  };

  recognition.onstart = () => {
    listening = true;
    listeningIndicator.classList.remove('off');
    listeningIndicator.classList.add('on');
    statusText.textContent = '음성 인식 중...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  };

  recognition.onend = () => {
    listening = false;
    listeningIndicator.classList.remove('on');
    listeningIndicator.classList.add('off');
    statusText.textContent = '대기 중';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    // 연속 동작: 사용자가 stop하지 않았으면 자동 재시작
    if (recognition && recognition.continuous && startBtn.disabled) {
      recognition.start();
    }
  };

  recognition.onerror = (e) => {
    console.error('Speech recognition error', e);
    statusText.textContent = '음성 인식 오류';
  };
}

// 시작/종료 버튼 이벤트
startBtn.addEventListener('click', () => {
  if (recognition && !listening) {
    finalTranscript = '';
    transcriptOutput.innerHTML = '';
    resetAnalysis();
    recognition.start();
  }
});

stopBtn.addEventListener('click', () => {
  if (recognition && listening) {
    recognition.stop();
  }
});

// TTS: 결과 읽어주기
speakBtn.addEventListener('click', () => {
  const textToSpeak = `현재 위험 점수는 ${totalScore}점. ${riskText.textContent}`;
  speakText(textToSpeak);
});

// ---------------------------
// 핵심 로직: 확정된 문장 처리
// ---------------------------
function handleFinalTranscript(textChunk) {
  // finalTranscript에 추가하여 누적
  if (finalTranscript) finalTranscript += ' ' + textChunk;
  else finalTranscript = textChunk;

  // 키워드 카운트 및 점수 계산
  analyzeTextForKeywords(textChunk);

  // 화면 업데이트
  transcriptOutput.innerHTML = highlightKeywords(escapeHtml(finalTranscript));
  updateUI();
}

// 키워드 분석 함수: 텍스트에서 키워드 빈도 세고 점수 합산
function analyzeTextForKeywords(text) {
  // 각 키워드 그룹을 순회하며 발생 횟수 계산
  KEYWORDS.forEach((group, idx) => {
    group.words.forEach(word => {
      // 전역, 대소문자 구분 없이 매칭 (한국어이므로 대소문자 영향 없음)
      const re = new RegExp(word, 'g');
      const matches = text.match(re);
      if (matches) {
        const count = matches.length;
        // 점수 증가: 단어 발생당 그룹의 score를 더함
        totalScore += group.score * count;
        // 카운트 업데이트: 그룹 키로 누적
        categoryCounts[group.key] += count;
        // 키워드 목록에 추가 (UI)
        for (let i = 0; i < count; i++) addKeywordToList(word);
      }
    });
  });

  // 점수 상한 처리
  if (totalScore > MAX_SCORE) totalScore = MAX_SCORE;
}

// UI 업데이트: 점수, 리스크 텍스트, 차트, 게이지 등
function updateUI() {
  scoreValue.textContent = totalScore;
  gaugePercent.textContent = totalScore + '%';
  gaugeFill.style.width = totalScore + '%';

  // 위험 문구 설정
  if (totalScore < 50) {
    riskText.textContent = '보이스피싱 가능성이 낮습니다';
    warningMsg.textContent = '';
    document.querySelector('.card').classList.remove('highRisk');
  } else if (totalScore < 80) {
    riskText.textContent = '주의가 필요합니다';
    warningMsg.textContent = '';
    document.querySelector('.card').classList.remove('highRisk');
  } else {
    riskText.textContent = '보이스피싱 가능성이 매우 높습니다';
    warningMsg.textContent = '경고: 높은 위험 신호가 감지되었습니다!';
    document.querySelector('.card').classList.add('highRisk');
  }

  // 차트 업데이트: KEYWORDS 순서에 맞게 카운트 전달
  const dataArr = KEYWORDS.map(k => categoryCounts[k.key]);
  riskChart.data.datasets[0].data = dataArr;
  riskChart.update();
}

// 키워드 항목을 하단 리스트에 추가
function addKeywordToList(word) {
  const li = document.createElement('li');
  li.textContent = word;
  keywordList.prepend(li);
  // 오래된 항목 자동 삭제 (UI 클린업)
  if (keywordList.children.length > 40) keywordList.removeChild(keywordList.lastChild);
}

// 분석 초기화 (새 세션 시작 시)
function resetAnalysis() {
  totalScore = 0;
  categoryCounts = { prosecutor:0, account:0, urgent:0, personal:0, install:0 };
  keywordList.innerHTML = '';
  riskChart.data.datasets[0].data = [0,0,0,0,0];
  riskChart.update();
  updateUI();
}

// 단순 HTML 이스케이프 (XSS 방지 목적)
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 키워드 하이라이트: 감지된 키워드를 빨간색 span으로 감싼다
function highlightKeywords(text) {
  // 다수의 키워드가 존재하므로 안전하게 치환
  KEYWORDS.forEach(group => {
    group.words.forEach(word => {
      const re = new RegExp('(' + escapeRegExp(word) + ')', 'g');
      text = text.replace(re, '<span class="kw">$1</span>');
    });
  });
  return text;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 간단한 TTS 래퍼
function speakText(text) {
  if (!('speechSynthesis' in window)) {
    alert('TTS를 지원하지 않는 브라우저입니다.');
    return;
  }
  const ut = new SpeechSynthesisUtterance(text);
  ut.lang = 'ko-KR';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(ut);
}

// 초기 UI 세팅
updateUI();
