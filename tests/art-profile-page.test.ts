import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), search: vi.fn(), push: vi.fn(), replace: vi.fn(), state: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: mocks.state, useEffect: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("../src/components/ui", () => ({ IconBack: () => null }));
vi.mock("../src/components/Art", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: mocks.search, useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({ default: ({ children }: React.PropsWithChildren) => children }));
vi.mock("server-only", () => ({}));
import ProfilePage from "../src/app/profile/page";
import { artProfileSchema } from "../src/server/core/art-profile";

type Element = React.ReactElement<Record<string, any>>;
const details = { gender: "neutral", ageRange: "30s", occupation: "개발자", appearance: "짧은 머리, 둥근 안경" };
const emptyDetails = { gender: "unspecified", ageRange: "unspecified", occupation: "", appearance: "" };

// A small hook-state driver calls the page's actual event handlers and re-renders
// its element tree. Real React server-render tests separately cover load/prefill.
function mount(profile: Record<string, unknown> | null = null, query = "") {
  const cells: any[] = [];
  let cursor = 0, dirty = false, tree: Element;
  const save = vi.fn().mockResolvedValue(undefined);
  let session = 0;
  const setAccount = (nextProfile: Record<string, unknown> | null, id = "account-a") => {
    const version = ++session;
    mocks.store.mockReturnValue({ db: { account: { id }, profile: nextProfile }, ready: true, authed: true, error: null,
      setProfile: save, refresh: vi.fn(), signOut: vi.fn(), isCurrentSession: () => version === session });
  };
  setAccount(profile);
  mocks.search.mockReturnValue(new URLSearchParams(query));
  mocks.state.mockImplementation((initial: unknown) => {
    const slot = cursor++;
    if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
    return [cells[slot], (value: unknown) => {
      const next = typeof value === "function" ? value(cells[slot]) : value;
      if (!Object.is(next, cells[slot])) { cells[slot] = next; dirty = true; }
    }];
  });
  const page = ProfilePage() as Element;
  const Component = (page.props.children as Element).type as () => Element;
  const render = () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      cursor = 0; dirty = false; tree = Component();
      if (!dirty) return;
    }
    throw new Error("Profile did not settle");
  };
  const all = (node: unknown): Element[] => {
    if (Array.isArray(node)) return node.flatMap(all);
    if (!React.isValidElement(node)) return [];
    const element = node as Element;
    return [element, ...all(element.props.children)];
  };
  const text = (node: unknown): string => {
    if (Array.isArray(node)) return node.map(text).join("");
    if (React.isValidElement(node)) return text((node as Element).props.children);
    return typeof node === "string" || typeof node === "number" ? String(node) : "";
  };
  const field = (id: string) => {
    const found = all(tree).find(node => node.props.id === id);
    if (!found) throw new Error(`Missing field ${id}`);
    return found;
  };
  const button = (label: string) => {
    const found = all(tree).find(node => node.type === "button" && text(node) === label);
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  const change = (id: string, value: unknown) => {
    field(id).props.onChange({ target: typeof value === "boolean" ? { checked: value } : { value } }); render();
  };
  render();
  return { save, render, setAccount, all: (node: unknown = tree) => all(node), field, button, change, text: (node: unknown = tree) => text(node) };
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("optional illustration profile", () => {
  test("a same-session dashboard refresh leaves unsaved profile edits available", () => {
    const profile = { nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true };
    const page = mount(profile, "step=details");
    page.change("art-appearance", "아직 저장하지 않은 외형");
    const store = mocks.store();
    mocks.store.mockReturnValue({ ...store, db: { ...store.db, profile: { ...profile } } });
    page.render();
    expect(page.field("art-appearance").props.value).toBe("아직 저장하지 않은 외형");
    expect(page.save).not.toHaveBeenCalled();
  });

  test("a changed login replaces the previous account's private profile and consent choices", async () => {
    const page = mount({ nick: "A", style: "water", consent: true, artProfile: details, artProfileEnabled: true }, "step=details");
    page.change("art-appearance", "A 계정의 미저장 외형");
    page.setAccount({ nick: "B", style: "pencil", consent: false }, "account-b");
    page.render();
    expect(page.field("art-appearance").props.value).toBe("");
    expect(page.field("art-occupation").props.value).toBe("");
    expect(page.field("ai-consent").props.checked).toBe(false);
    expect(page.field("art-profile-enabled").props.checked).toBe(false);
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save).toHaveBeenCalledWith({ nick: "B", style: "pencil", consent: false, artProfile: emptyDetails, artProfileEnabled: false });
  });

  test("a fresh login without a profile starts onboarding instead of keeping the previous editor", () => {
    const page = mount({ nick: "A", style: "water", consent: true, artProfile: details, artProfileEnabled: true }, "step=style");
    // A same-account logout and login is also a new session.
    page.setAccount(null);
    page.render();
    expect(page.text()).toContain("뭐라고 불러드릴까요?");
    const name = page.all().find(node => node.type === "input" && node.props.autoComplete === "nickname")!;
    expect(name.props.value).toBe("");
    expect(page.field("art-appearance").props.value).toBe("");
    expect(page.button("다음").props.disabled).toBe(true);
  });

  test.each(["resolve", "reject"])("a previous account's late save %s cannot navigate or change the new profile form", async outcome => {
    const page = mount({ nick: "A", style: "water", consent: true, artProfile: details, artProfileEnabled: true }, "step=details");
    let finish!: () => void;
    page.save.mockReturnValueOnce(new Promise<void>((resolve, reject) => { finish = () => outcome === "resolve" ? resolve() : reject(new Error("A 계정 저장 실패")); }));
    const pending = page.button("프로필 저장하기").props.onClick();
    page.render();
    page.setAccount({ nick: "B", style: "pencil", consent: false }, "account-b");
    page.render();
    expect(page.button("프로필 저장하기").props.disabled).toBe(false);
    finish(); await pending; page.render();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(page.text()).not.toContain("A 계정 저장 실패");
    expect(page.field("art-appearance").props.value).toBe("");
  });

  test("a failed save preserves entered details and can be retried", async () => {
    const page = mount({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true }, "step=details");
    page.change("art-appearance", "수정한 외형");
    page.save.mockRejectedValueOnce(new Error("연결이 끊겼어요."));
    await page.button("프로필 저장하기").props.onClick(); page.render();
    expect(page.field("art-appearance").props.value).toBe("수정한 외형");
    expect(page.button("프로필 저장하기").props.disabled).toBe(false);
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save).toHaveBeenCalledTimes(2);
    expect(page.save.mock.calls[1][0].artProfile.appearance).toBe("수정한 외형");
    expect(mocks.push).toHaveBeenCalledWith("/me");
  });

  test("new accounts start with optional blanks and cannot enable transmission without AI consent", () => {
    const page = mount();
    expect(page.field("art-gender").props.value).toBe("unspecified");
    expect(page.field("art-age").props.value).toBe("unspecified");
    expect(page.field("art-occupation").props.value).toBe("");
    expect(page.field("art-appearance").props.value).toBe("");
    expect(page.field("art-profile-enabled").props).toMatchObject({ checked: false, disabled: true });
    expect(page.field("art-occupation").props.maxLength).toBe(80);
    expect(page.field("art-appearance").props.maxLength).toBe(200);
    expect(page.text()).toContain("선택 입력");
    expect(page.save).not.toHaveBeenCalled();
  });

  test("legacy profiles get blank details without automatically enabling them", async () => {
    const page = mount({ nick: "기존 이름", style: "water", consent: true });
    expect(page.field("art-profile-enabled").props).toMatchObject({ checked: false, disabled: false });
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save).toHaveBeenCalledWith({ nick: "기존 이름", style: "water", consent: true, artProfile: emptyDetails, artProfileEnabled: false });
    expect(mocks.push).toHaveBeenCalledWith("/me");
  });

  test("the details shortcut prefills saved choices and saves edits without changing the style", async () => {
    const page = mount({ nick: "나", style: "crayon", consent: true, artProfile: details, artProfileEnabled: true }, "step=details");
    expect(page.text()).toContain("그림 속 내 모습");
    expect(page.field("art-gender").props.value).toBe("neutral");
    expect(page.field("art-age").props.value).toBe("30s");
    expect(page.field("art-profile-enabled").props.checked).toBe(true);
    page.change("art-occupation", "  대학원생  ");
    page.change("art-appearance", "  긴 머리  ");
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save).toHaveBeenCalledWith({ nick: "나", style: "crayon", consent: true,
      artProfile: { ...details, occupation: "대학원생", appearance: "긴 머리" }, artProfileEnabled: true });
  });

  test("descriptions remain readable and count normalized input that the profile API accepts", async () => {
    const page = mount({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true }, "step=details");
    expect(page.field("art-appearance").type).toBe("textarea");
    expect(page.field("art-appearance").props).toMatchObject({ rows: 3, maxLength: 200, value: details.appearance });
    expect(page.field("art-appearance").props["aria-describedby"]).toContain("art-appearance-count");
    page.change("art-appearance", "짧은 머리\r\n둥근 안경\t갈색 옷\u0000");
    page.change("art-occupation", "개발자\n학생");
    expect(page.field("art-appearance").props.value).toBe("짧은 머리 둥근 안경 갈색 옷 ");
    expect(page.text(page.field("art-appearance-count"))).toBe(`${page.field("art-appearance").props.value.length}/200자`);
    expect(page.text(page.field("art-occupation-count"))).toBe("6/80자");
    await page.button("프로필 저장하기").props.onClick();
    const saved = page.save.mock.calls[0][0].artProfile;
    expect(saved).toMatchObject({ occupation: "개발자 학생", appearance: "짧은 머리 둥근 안경 갈색 옷" });
    expect(artProfileSchema.safeParse(saved).success).toBe(true);
  });

  test.each(["step=details", "step=style"])("AI consent stays in the scrolling content and save errors stay beside the action in %s", async query => {
    const page = mount({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true }, query);
    const main = page.all().find(node => node.type === "main")!;
    const footer = page.all().find(node => typeof node.props.className === "string" && node.props.className.split(" ").includes("bar"))!;
    expect(page.all(main).some(node => node.props.id === "ai-consent")).toBe(true);
    expect(page.all(footer).some(node => node.type === "input")).toBe(false);
    page.save.mockRejectedValueOnce(new Error("프로필을 저장하지 못했어요."));
    await page.button(query === "step=style" ? "수채화로 저장하기" : "프로필 저장하기").props.onClick();
    page.render();
    const updatedFooter = page.all().find(node => typeof node.props.className === "string" && node.props.className.split(" ").includes("bar"))!;
    const error = page.all(updatedFooter).find(node => node.props.role === "alert");
    expect(page.text(error)).toBe("프로필을 저장하지 못했어요.");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test("style-only editing preserves stored detailed information and its enabled choice", async () => {
    const page = mount({ nick: "나", style: "pencil", consent: true, artProfile: details, artProfileEnabled: true }, "step=style");
    expect(page.text()).toContain("어떤 그림체로 바꿀까요?");
    const nextStyle = page.all().find(node => node.type === "button" && node.props.role === "radio" && !node.props["aria-checked"])!;
    nextStyle.props.onClick(); page.render();
    await page.button("수채화로 저장하기").props.onClick();
    expect(page.save).toHaveBeenCalledWith({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true });
  });

  test("withdrawing AI consent disables detailed profile use and reconsenting does not silently reenable it", async () => {
    const page = mount({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true });
    page.change("ai-consent", false);
    expect(page.field("art-profile-enabled").props).toMatchObject({ checked: false, disabled: true });
    page.change("ai-consent", true);
    expect(page.field("art-profile-enabled").props).toMatchObject({ checked: false, disabled: false });
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save.mock.calls[0][0]).toMatchObject({ consent: true, artProfileEnabled: false, artProfile: details });
  });

  test("turning reflection off keeps editable information but sends an explicit false", async () => {
    const page = mount({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true });
    page.change("art-profile-enabled", false);
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save.mock.calls[0][0]).toMatchObject({ artProfile: details, artProfileEnabled: false });
  });

  test("blanking optional entries clears them in the save payload", async () => {
    const page = mount({ nick: "나", style: "water", consent: true, artProfile: details, artProfileEnabled: true });
    page.change("art-gender", "unspecified"); page.change("art-age", "unspecified");
    page.change("art-occupation", ""); page.change("art-appearance", "");
    await page.button("프로필 저장하기").props.onClick();
    expect(page.save.mock.calls[0][0].artProfile).toEqual(emptyDetails);
  });

  test("onboarding carries detail choices through style selection and waits for the save", async () => {
    const page = mount();
    const name = page.all().find(node => node.type === "input" && node.props.autoComplete === "nickname")!;
    name.props.onChange({ target: { value: "첫 기록" } }); page.render();
    page.change("ai-consent", true); page.change("art-profile-enabled", true);
    page.change("art-gender", "female"); page.change("art-age", "20s");
    page.change("art-occupation", "학생"); page.change("art-appearance", "안경");
    page.button("다음").props.onClick(); page.render();
    const style = page.all().find(node => node.type === "button" && node.props.role === "radio")!;
    style.props.onClick(); page.render();
    let finish!: () => void;
    page.save.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const saving = page.button("수채화로 시작하기").props.onClick(); page.render();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(page.field("ai-consent").props.disabled).toBe(true);
    expect(page.save.mock.calls[0][0]).toEqual({ nick: "첫 기록", style: "water", consent: true, artProfileEnabled: true,
      artProfile: { gender: "female", ageRange: "20s", occupation: "학생", appearance: "안경" } });
    finish(); await saving;
    expect(mocks.push).toHaveBeenCalledWith("/guide");
  });
});
