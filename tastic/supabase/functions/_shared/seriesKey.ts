// 제목 끝의 시리즈 표지(속편 번호·시즌·부·권)를 뽑아 비교한다.
//
// 왜 필요한가: trigram 유사도는 '악마는 프라다를 입는다' 와 '악마는 프라다를 입는다 2' 를
// 0.87 로 본다. 캐시 확정선(0.85)보다 **높다**. 그래서 카탈로그에 없는 속편을 검색하면
// 1편이 "같은 작품"으로 잡혀 그 메타데이터가 그대로 반환되고(읽기 경로),
// 속편을 확정하면 1편 행의 메타데이터를 덮어쓴다(쓰기 경로).
//
// 글자 유사도로는 이 차이를 절대 가를 수 없다 — 1편과 속편은 원래 제목이 거의 같기 때문이다.
// 그래서 번호를 따로 떼어내 별도 축으로 비교한다. 번호가 다르면 유사도가 아무리 높아도
// 다른 작품이다.
//
// 한계(의도한 것): 숫자가 없는 속편 표기('Dune: Part Two', '리부트' 등)는 못 가른다.
// 실측된 실패 사례(숫자형)를 막는 것이 목적이고, 못 가른 경우는 기존 동작 그대로다.

/**
 * 제목에서 시리즈 표지를 뽑는다. 표지가 없으면 빈 문자열.
 *   '악마는 프라다를 입는다'    → ''
 *   '악마는 프라다를 입는다 2'  → 'n2'
 *   '피의 게임 3'              → 'n3'
 *   '성난 사람들 시즌2'         → 's2'
 *   '슬기로운 의사생활 3부'     → 's3'
 *   'Blade Runner 2049'        → 'n2049'   (1편과 다른 작품이 맞다)
 *   '1987'                     → ''        (제목 자체가 숫자면 표지가 아니다)
 */
export function seriesKey(title: string | null | undefined): string {
  if (!title) return "";
  const t = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // 구두점 제거 (':', '.', '-' 등)
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";

  // ① 키워드가 숫자 앞에 오는 표기 — '시즌 2', 'season 2', 'part 3', 'vol 1'
  const kwFirst = t.match(/(?:시즌|시리즈|파트|season|part|vol|volume|chapter)\s*(\d{1,3})$/);
  if (kwFirst) return `s${kwFirst[1]}`;

  // ② 키워드가 숫자 뒤에 오는 표기 — '3부', '2기', '1권'
  const kwLast = t.match(/(\d{1,3})\s*(?:기|부|편|권)$/);
  if (kwLast) return `s${kwLast[1]}`;

  // ③ 끝에 붙은 맨 숫자 — '피의 게임 3', '쿵푸팬더4'
  //    제목 전체가 숫자인 경우('1987')는 표지가 아니라 제목이므로 제외한다.
  const trailing = t.match(/(\d{1,4})$/);
  if (trailing && t !== trailing[1]) return `n${trailing[1]}`;

  return "";
}

/**
 * 검색어와 카탈로그 행이 같은 시리즈 편인지. 원제 쪽 표기로도 맞춰본다
 * (국내명으로 저장된 행을 원제로 찾는 경로가 있다).
 */
export function sameSeriesEntry(
  queryTitle: string,
  rowTitle: string | null | undefined,
  rowOriginalTitle?: string | null,
): boolean {
  const q = seriesKey(queryTitle);
  if (q === seriesKey(rowTitle)) return true;
  if (rowOriginalTitle && q === seriesKey(rowOriginalTitle)) return true;
  return false;
}
