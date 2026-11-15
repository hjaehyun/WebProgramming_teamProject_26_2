// The songs a picture can get, hand-picked per mood (piano covers on YouTube).
// Format: a [mood] header, then one "videoId | 곡 | 채널" line per song. To change the list, edit it
// here: the server re-checks every video with YouTube and updates the shared song_pool table within a
// day (see music.ts). A removed line also removes that song from the pictures it was attached to.
export const SONG_LIST = `
[calm]
0nROjv1QCn4 | 아이유 - 밤편지 | DooPiano
sjiydBdJaE0 | 폴킴 - 모든 날, 모든 순간 | Piano in U
wkEhHHO5tWg | 악뮤 - 오랜 날 오랜 밤 | DooPiano
uaCGi_Z6gIc | 아이유 - 가을 아침 | DooPiano
_ZZOyInwfHI | 폴킴 - 안녕 | Piano in U
69hg7UotUjc | 정승환 - 너였다면 | Piano in U
_UrTl1VlO5U | 이적 - 걱정말아요 그대 | Pianoheart
1XOq2xPUoPM | 악뮤 - 시간과 낙엽 | Reynah
smV72nePPhU | 방탄소년단 - 봄날 | Piano in U
fGlOWDYCPRE | 에일리 - 첫눈처럼 너에게 가겠다 | HOON TO-BE
Q48g2QnWcPM | 찬열·펀치 - Stay With Me | Daijipiano
eoeEIi7vizc | 정준일 - 안아줘 | Pianoheart
65I8BpfFz00 | 김필 - 그때 그 아인 | Piano in U
GqPLC0J4cKs | 이하이 - 한숨 | Piano in U
GhyG456O6pA | 박효신 - 숨 | Pianoheart
YAE6wvYSeOs | 임영웅 - 사랑은 늘 도망가 | Jichan Park
Yn-NqjMWZb4 | 김동률 - 감사 | Piano in U
HWO327AZLfs | 아이유 - 겨울잠 | DooPiano
8itfMOe1Y2Y | 오혁 - 소녀 | Piano in U
UwmhBlRtdQs | 케이시 - 그때가 좋았어 | Piano in U

[cozy]
fjruMjhR__0 | 아이유 - 마음 | DooPiano
kgr1YiuVPvA | 폴킴 - 너를 만나 | Piano in U
6FXIWTezTqY | 멜로망스 - 선물 | DooPiano
mL353cttRRo | 적재 - 별 보러 가자 | Piano in U
6mddhI7gX_k | 잔나비 - 주저하는 연인들을 위해 | Piano in U
Bs2k37ZbYFk | 아이유 - 너의 의미 | Pianoheart
txuTlgRA4s8 | 10cm - 폰서트 | Piano in U
pmLW5XmRJQo | 스탠딩 에그 - 오래된 노래 | Piano in U
XagRSiGYXdU | 장범준 - 흔들리는 꽃들 속에서 네 샴푸향이 느껴진거야 | Piano in U
em8gr2KHWmA | 성시경 - 내게 오는 길 | Pianoheart
3dZz6EyNkAg | 이승철 - 그런 사람 또 없습니다 | Pianoheart
Js5XtEZfMJ8 | 아이유 - 팔레트 | DooPiano
b-h2CViLrAI | 방탄소년단 - 소우주 | DooPiano
uRowCdGuXKM | 이무진 - 에피소드 | 건반윤
2MCVVliSWo0 | 10cm - 스토커 | Piano in U
3oyvs1ZTZAU | 방탄소년단 - Magic Shop | DooPiano
ne57iwBIn1Y | 샘김 - Who Are You | DooPiano
3Jvx0RS9ws4 | 소유 - I Miss You | Piano in U
e8Zi2eme7ZA | 자이언티 - 양화대교 | Pianoheart
o27OvZ9UKmI | 김세정 - 꽃길 | Pianoheart

[lively]
6r47XH43JC0 | 아이유 - 좋은 날 | Pianoheart
2vNKLh-2zZ0 | 볼빨간사춘기 - 여행 | DooPiano
nfGnLg5TV6A | 데이식스 - 한 페이지가 될 수 있게 | 건반윤
axBgi-Mt7nI | 악뮤 - 200% | Pianoheart
olbTKpau0wE | 싹쓰리 - 다시 여기 바닷가 | Jichan Park
0RdmgeAIXHA | 아이유 - Blueming | Piano in U
LJGtefz71ZM | 아이유 - 라일락 | Jichan Park
gWEm8pdikQg | 지코 - 아무노래 | Piano in U
HJ8bc1BrccQ | 방탄소년단 - Dynamite | Pianella Piano
HfMRUts1wZo | 방탄소년단 - 작은 것들을 위한 시 | DooPiano
fTM6qCJOBp8 | 방탄소년단 - Butter | Pianella Piano
Bdn2fJCZG0A | 트와이스 - Cheer Up | DooPiano
px_7va6yUWE | 트와이스 - What is Love | Pianella Piano
RnUlpP2LGqU | 레드벨벳 - 빨간 맛 | DooPiano
yrZjQsE4CxU | 뉴진스 - Hype Boy | Pianella Piano
GDzy4AXetlI | 뉴진스 - Super Shy | Pianella Piano
yBcPp7bCI7Q | 아이브 - Love Dive | 건반윤
g0xFiduQ7FY | 아이브 - After Like | Pianella Piano
N4Vax_h41VE | 세븐틴 - 아주 NICE | Smyang Piano
8Kdggpun0xw | 이무진 - 신호등 | 건반윤

[lonely]
CNhRjomTmoM | 김광석 - 서른 즈음에 | CelloDeck
s2b-oVflvbM | 이문세 - 옛사랑 | Pianoheart
kMWovNjEHGQ | 박효신 - 야생화 | Pianoheart
wt2uh8Jr_9w | 악뮤 - 어떻게 이별까지 사랑하겠어, 널 사랑하는 거지 | DooPiano
NtL9HrkrIPU | 윤종신 - 좋니 | HOON TO-BE
qBloZwaLjSY | 김범수 - 보고싶다 | RealPiano낮사람
UfMHpwZxv2g | 임창정 - 소주 한 잔 | Pianoheart
bAWv7rnjfPU | 태연 - 만약에 | Piano in U
3kGzRvhpuPE | 아이유 - 이런 엔딩 | DooPiano
s-tHZaqKQQI | 아이유 - 나의 옛날이야기 | Pianoheart
D-FyX0VuBRE | 헤이즈 - 비도 오고 그래서 | DooPiano
vIhiGHfwLcc | 데이식스 - 예뻤어 | Piano in U
p6o0Z3G5U-Q | 거미 - You Are My Everything | Pianoheart
A0XIuLJU818 | 성시경 - 거리에서 | Pianoheart
eKU8kiNJV1A | 엠씨더맥스 - 어디에도 | HOON TO-BE
jZJ3NTNkuFg | 다비치 - 이 사랑 | Pianoheart
D3scyfzqRU0 | 블랙핑크 - STAY | Pianella Piano
5W0-Vz6bSN4 | 빅뱅 - 봄여름가을겨울 | DooPiano
6mCAQI95Crg | 빅뱅 - IF YOU | Pianoheart
pgEYbVQAYbk | 지드래곤 - 무제 | 건반윤

[flutter]
kGkb_mdvGfo | 버스커버스커 - 벚꽃 엔딩 | Pianoheart
-6Z4Nproklg | 멜로망스 - 사랑인가 봐 | Piano in U
obBd7EF7tU8 | HIGH4·아이유 - 봄 사랑 벚꽃 말고 | Pianoheart
fXj3Glj7M7w | 로꼬·펀치 - Say Yes | Nickey Piano
BIzQpRKNiy8 | 아이유 - 금요일에 만나요 | Pianoheart
WPLtwXSqn54 | 10cm - 그라데이션 | Piano in U
oOyj1yoCUVg | 볼빨간사춘기 - 썸 탈꺼야 | DooPiano
qHrpyRRLKpo | 볼빨간사춘기 - 좋다고 말해 | DooPiano
qblWcGeyXAo | 소유·정기고 - 썸 | Pianoheart
RW-lEkG7Bvc | 첸 - 벚꽃연가 | Piano in U
zHwJG8Rrx6c | 세븐틴 - 예쁘다 | DooPiano
0Wu6uTMkMyI | 수지·백현 - Dream | Pianoheart
gqpBagVOa5U | 여자친구 - 시간을 달려서 | 건반윤
SfdwT7kWRMw | 여자친구 - 오늘부터 우리는 | Pianoheart
KbEy3bIMkUE | 트와이스 - Knock Knock | DooPiano
HsAgEPbHl4Q | 엑소 - 첫 눈 | Piano in U
QHKrYp8mSH0 | 볼빨간사춘기 - 우주를 줄게 | DooPiano
OM-vseP42do | 윤하 - 오르트구름 | JH Piano
jWbyjZe-7uk | 로꼬·유주 - 우연히 봄 | Pianoheart
Y5JcZQ0xg4Y | 레드벨벳 - 러시안 룰렛 | DooPiano

[dreamy]
UtQS1lFxeMs | 뉴진스 - Ditto | DooPiano
jQEkJnQp4_8 | 태연 - 11:11 | Funguypiano
pvsbm1LAEuU | 태연 - Rain | Smyang Piano
oIM_6J4Vgzs | 볼빨간사춘기 - 나의 사춘기에게 | DooPiano
ThM9TBWdahw | 태연 - I | Pianoheart
wXKnjPeAYDw | 태연 - Fine | DooPiano
I446pbN_IBU | 아이유 - Love poem | DooPiano
fh_3wgZP-gQ | 아이유 - strawberry moon | DooPiano
eIFoJUHeEnw | 딘 - instagram | DooPiano
CY8oeEja1D0 | 딘 - D (half moon) | PIANO BLANC
FUIRnaup8wc | 헤이즈 - 저 별 | DooPiano
9jDhDTQKvQ4 | 크러쉬 - Beautiful | Piano in U
D6Jb411ddtc | 레드벨벳 - Psycho | Pianella Piano
Lg2xRTN_9OI | 방탄소년단 - Butterfly | DooPiano
kPAlC5rBijE | 방탄소년단 - Serendipity | DooPiano
awPbny_HrpM | 방탄소년단 - FAKE LOVE | DooPiano
R7yYi6ft8sU | 지민 - 약속 | DooPiano
uIdAf28vEa8 | 뷔 - 풍경 | DooPiano
gpFFdQC6sfk | 뷔 - Sweet Night | DooPiano
o0OwkJaRtWU | 엑소 - Universe | DooPiano
`;
