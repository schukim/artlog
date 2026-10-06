// generate-review 회귀 픽스처. 입력은 Edge Function 요청 바디의 content / conversation_history 와 같은 형태.

export interface ReviewFixture {
  name: string;
  content: { title: string; category: string; creator: string | null; year: number | null; genre: string | null };
  conversation: { role: "interviewer" | "user"; text: string }[];
}

// 실제 인터뷰 5ab32650-3040-4d68-b947-3c7fd2f40514 의 대화 (user_id 등 식별 정보 제외).
// 문제였던 최종본: "추적"(부정된 전제)이 마무리에서 "서로를 쫓는 긴장의 사슬이 아니라"로
// 되살아났고, 마지막 턴(평론 수정 요청)의 문구가 "긴장감이 있다는 것보다", "…라는 말은
// 과장이 아니었다"로 본문에 인용됐다.
export const ASSASSINS_REQUEST_TURN: ReviewFixture = {
  name: "5ab32650 암살자(들) — 부정 전제 + 평론 요청 턴",
  content: {
    title: "암살자(들)",
    category: "movie",
    creator: "허진호",
    year: 2026,
    genre: "범죄, 드라마, 역사, 스릴러",
  },
  conversation: [
    { role: "interviewer", text: "정치적 음모와 심리적 추적이 뒤섞인 이야기를 보면서, 영화가 나를 긴장하게 만든 순간과 오히려 감정의 여백으로 멈춰 세운 순간 중 어느 쪽이 더 크게 다가왔나요?" },
    { role: "user", text: "감정의 여백이 무슨 뜻이지?" },
    { role: "interviewer", text: "아, 제가 어렵게 말했네요. 그러면 이렇게 여쭤볼게요 — 영화를 보는 동안 숨이 탁 막히듯 긴장된 순간과, 화면이 잠시 조용해지면서 마음이 가라앉는 순간 중에 어느 쪽이 더 오래 기억에 남았나요?" },
    { role: "user", text: "긴장된 순간이 많았지" },
    { role: "interviewer", text: "영화 속에서 인물들이 서로를 추적하고 의심하는 장면들 중에, 특히 누가 누구를 쫓는지 헷갈릴 만큼 관계가 얽혔던 순간이 있었나요?" },
    { role: "user", text: "아니" },
    { role: "interviewer", text: "그 긴장된 순간들 중에, 화면이 조용해지는데도 오히려 더 팽팽하게 느껴졌던 장면이 있었나요?" },
    { role: "user", text: "언론자유선언문을 읽는 박해일과 그를 둘러싸고 보호해주는 선후배 기자들의 모습이 제일 인상깊었어" },
    { role: "interviewer", text: "그 장면이 제일 인상 깊었다니, 반대로 보면서 좀 아쉽거나 기대와 달랐던 부분도 있었나요?" },
    { role: "user", text: "유명인이 너무 많이 나와서 몰입이 힘들게 쟤는 누구지를 찾는 추석특집쑈같는 분위기가 있었오" },
    { role: "interviewer", text: "그 장면들 다 지나고 나서, 지금 돌아보면 이 영화에서 제일 오래 마음에 남는 건 뭔가요?" },
    { role: "user", text: "평론을 전체적으로 고쳐줘. 긴장감이 있다는 것보다 유명배우가 많이 나와 왼전 몰입을 오히려 저해했고 특집쇼같았다로" },
  ],
};

// 가짜 라이트 유저: 스스로 꺼낸 말(①)은 "재밌었어"뿐이고, 인터뷰어가 제시한
// 구체적 장면 하나를 "응"으로 긍정(②)했다. 나머지는 무효 턴.
export const LIGHT_USER_AFFIRMED_SCENE: ReviewFixture = {
  name: "라이트 유저 — 막연한 ① + 장면 하나를 긍정한 ②",
  content: {
    title: "헤어질 결심",
    category: "movie",
    creator: "박찬욱",
    year: 2022,
    genre: "미스터리, 멜로, 드라마",
  },
  conversation: [
    { role: "interviewer", text: "영화를 다 보고 나서 첫 느낌은 어땠나요?" },
    { role: "user", text: "재밌었어" },
    { role: "interviewer", text: "마지막 해변에서 서래가 스스로 판 모래 구덩이 속으로 사라지고, 해준이 밀물 속에서 그녀를 찾아 헤매는 장면이 특히 오래 남았나요?" },
    { role: "user", text: "응" },
    { role: "interviewer", text: "영화 곳곳에 흐르던 음악이나 소리 중에 기억나는 게 있나요?" },
    { role: "user", text: "모르겠어" },
    { role: "interviewer", text: "해준과 서래의 대화에서 번역기를 쓰는 장면들은 어떻게 느껴졌나요?" },
    { role: "user", text: "글쎄" },
    { role: "interviewer", text: "보면서 아쉽거나 기대와 달랐던 부분은 없었나요?" },
    { role: "user", text: "없었어" },
    { role: "interviewer", text: "지금 돌아보면 이 영화에서 제일 오래 마음에 남는 건 뭔가요?" },
    { role: "user", text: "그냥 재밌었어" },
  ],
};
