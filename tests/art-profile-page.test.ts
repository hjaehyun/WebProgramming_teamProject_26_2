import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), search: vi.fn(), push: vi.fn(), replace: vi.fn(), state: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: mocks.state, useEffect: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("../src/components/ui", () => ({ IconBack: () => null }));
vi.mock("../src/components/Art", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: mocks.search, useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({ default: ({ children }: React.PropsWithChildren) => children }));
import ProfilePage from "../src/app/profile/page";

type Element = React.ReactElement<Record<string, any>>;
const details = { gender: "neutral", ageRange: "30s", occupation: "개발자", appearance: "짧은 머리, 둥근 안경" };
const emptyDetails = { gender: "unspecified", ageRange: "unspecified", occupation: "", appearance: "" };

// A small hook-state driver calls the page's actual event handlers and re-renders
// its element tree. Real React server-render tests separately cover load/prefill.
function mount(profile: Record<string, unknown> | null = null, query = "") {
  const cells: any[] = [];
  let cursor = 0, dirty = false, tree: Element;
  const save = vi.fn().mockResolvedValue(undefined);
  mocks.store.mockReturnValue({ db: { profile }, ready: true, authed: true, error: null, setProfile: save, refresh: vi.fn(), signOut: vi.fn() });
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
  return { save, render, all: () => all(tree), field, button, change, text: () => text(tree) };
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("optional illustration profile", () => {
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

  test("style-only editing preserves stored detailed information and its enabled choice", async () => {
    const page = mount({ nick: "나", style: "pencil", consent: true, artProfile: details, artProfileEnabled: true }, "step=style");
    expect(page.text()).toContain("어떤 그림체로 바꿀까요?");
    await page.button("색연필로 저장하기").props.onClick();
    expect(page.save).toHaveBeenCalledWith({ nick: "나", style: "pencil", consent: true, artProfile: details, artProfileEnabled: true });
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
    expect(page.save.mock.calls[0][0]).toEqual({ nick: "첫 기록", style: "water", consent: true, artProfileEnabled: true,
      artProfile: { gender: "female", ageRange: "20s", occupation: "학생", appearance: "안경" } });
    finish(); await saving;
    expect(mocks.push).toHaveBeenCalledWith("/guide");
  });
});
