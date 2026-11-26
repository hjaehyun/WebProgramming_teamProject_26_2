import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), state: vi.fn(), ref: vi.fn(), effect: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: mocks.state, useRef: mocks.ref, useEffect: mocks.effect }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({ default: ({ children }: React.PropsWithChildren) => children }));
import LoginPage from "../src/app/page";

type Element = React.ReactElement<Record<string, any>>;
const disposers: (() => void)[] = [];

// Exercise the real handlers with persistent hook cells, including effect cleanup
// and wall-clock timers. Browser checks separately cover DOM focus and layout.
function mount() {
  const cells: any[] = [];
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>();
  let cursor = 0, pendingEffects: (() => void)[] = [], tree: Element;
  const signUp = vi.fn().mockResolvedValue({ confirmationRequired: true });
  const signIn = vi.fn().mockResolvedValue({ profile: {} });
  mocks.store.mockReturnValue({ ready: true, authed: false, db: { profile: null }, signUp, signIn });
  mocks.state.mockImplementation((initial: unknown) => {
    const slot = cursor++;
    if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
    return [cells[slot], (next: unknown) => { cells[slot] = typeof next === "function" ? next(cells[slot]) : next; }];
  });
  mocks.ref.mockImplementation((initial: unknown) => {
    const slot = cursor++;
    if (!(slot in cells)) cells[slot] = { current: initial };
    return cells[slot];
  });
  mocks.effect.mockImplementation((effect: () => (() => void) | undefined, deps: unknown[]) => {
    const slot = cursor++, old = effects.get(slot);
    if (old && deps.every((dep, i) => Object.is(dep, old.deps[i]))) return;
    pendingEffects.push(() => { old?.cleanup?.(); effects.set(slot, { deps, cleanup: effect() }); });
  });
  const all = (node: unknown): Element[] => Array.isArray(node) ? node.flatMap(all) : React.isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
  const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join("") : React.isValidElement(node) ? text((node as Element).props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
  const page = LoginPage() as Element;
  const Component = (page.props.children as Element).type as () => Element;
  const render = () => {
    cursor = 0; pendingEffects = []; tree = Component();
    for (const node of all(tree)) if (typeof node.type === "string" && node.props.ref && !node.props.ref.current) node.props.ref.current = { focus: vi.fn() };
    for (const effect of pendingEffects) effect();
  };
  const input = (label: string) => {
    const field = all(tree).find(node => node.type === "label" && text(node).startsWith(label));
    const found = field && all(field).find(node => node.type === "input");
    if (!found) throw new Error(`Missing input ${label}`);
    return found;
  };
  const button = (label: string) => {
    const found = all(tree).find(node => node.type === "button" && text(node) === label);
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  const resend = () => all(tree).find(node => node.type === "button" && /인증 메일 (다시 받기|요청 중)/.test(text(node)))!;
  const heading = () => all(tree).find(node => node.props.id === "auth-form-title")!;
  const change = (label: string, value: string) => { input(label).props.onChange({ target: { value } }); render(); };
  const click = (label: string) => { button(label).props.onClick(); render(); };
  const submit = async () => { await all(tree).find(node => node.type === "form")!.props.onSubmit({ preventDefault: vi.fn() }); render(); };
  const dispose = () => { effects.forEach(effect => effect.cleanup?.()); effects.clear(); };
  disposers.push(dispose);
  render();
  return { render, signUp, signIn, input, button, resend, heading, change, click, submit, dispose, text: () => text(tree) };
}

function prepareSignup() {
  const page = mount();
  page.click("회원가입");
  page.change("이메일", "new@example.com");
  page.change("비밀번호", "preview-only-123");
  page.change("비밀번호 확인", "preview-only-123");
  return page;
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-26T09:00:00Z"));
  vi.stubGlobal("React", React); vi.stubGlobal("document", new EventTarget()); vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("signup and confirmation recovery", () => {
  test("signup has a required confirmation field and switching mode clears passwords but preserves email", () => {
    const page = prepareSignup();
    expect(page.text()).toContain("이메일을 인증하고 나만의 하루조각을 시작해요.");
    expect(page.heading().props.ref.current.focus).toHaveBeenCalledOnce();
    expect(page.input("비밀번호 확인").props).toMatchObject({ required: true, minLength: 8, maxLength: 128, autoComplete: "new-password" });
    page.click("로그인");
    expect(page.text()).toContain("남겨 둔 조각들을 이어서 만나보세요.");
    expect(page.input("이메일").props.value).toBe("new@example.com");
    expect(page.input("비밀번호").props.value).toBe("");
    expect(() => page.input("비밀번호 확인")).toThrow();
    page.click("회원가입");
    expect(page.input("비밀번호 확인").props.value).toBe("");
  });

  test("mismatched passwords never reach signup and focus the confirmation input", async () => {
    const page = prepareSignup();
    page.change("비밀번호 확인", "different-password");
    await page.submit();
    expect(page.signUp).not.toHaveBeenCalled();
    expect(page.input("비밀번호 확인").props["aria-invalid"]).toBe(true);
    expect(page.input("비밀번호 확인").props.ref.current.focus).toHaveBeenCalledOnce();
    expect(page.text()).toContain("비밀번호가 서로 달라요");
  });

  test("confirmed signup clears both passwords and prevents an immediate resend", async () => {
    const page = prepareSignup();
    await page.submit();
    expect(page.signUp).toHaveBeenCalledWith("new@example.com", "preview-only-123");
    expect(page.input("비밀번호").props.value).toBe("");
    expect(page.input("비밀번호 확인").props.value).toBe("");
    expect(page.text()).toContain("스팸메일함과 프로모션함");
    expect(page.resend().props.disabled).toBe(true);
    await page.resend().props.onClick();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test("resend uses elapsed wall time, blocks duplicate clicks and respects Retry-After", async () => {
    const page = prepareSignup();
    await page.submit();
    vi.setSystemTime(Date.now() + 90_000);
    vi.advanceTimersByTime(1000); page.render();
    expect(page.resend().props.disabled).toBe(false);
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const action = page.resend().props.onClick;
    const pending = action();
    await action(); page.render();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/auth/resend-confirmation", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@example.com" }) }));
    expect(page.input("이메일").props.disabled).toBe(true);
    finish(new Response(JSON.stringify({ error: "요청이 많아요. 잠시 후 다시 해주세요." }), { status: 429, headers: { "Retry-After": "120" } }));
    await pending; page.render();
    expect(page.text()).toContain("요청이 많아요");
    expect(page.text()).toContain("다시 받기 (120초)");
    vi.advanceTimersByTime(60_000); page.render();
    expect(page.resend().props.disabled).toBe(true);
    vi.advanceTimersByTime(60_000); page.render();
    expect(page.resend().props.disabled).toBe(false);
    page.click("로그인하기");
    expect(page.text()).not.toContain("요청이 많아요");
    expect(page.input("비밀번호").props.ref.current.focus).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("successful resend reports the neutral server message and cleans its timer on unmount", async () => {
    const page = prepareSignup();
    await page.submit();
    vi.advanceTimersByTime(60_000); page.render();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "인증이 필요한 주소라면 메일함을 확인해 주세요.", retryAfterSeconds: 60 }), { status: 200 }));
    await page.resend().props.onClick(); page.render();
    expect(page.text()).toContain("인증이 필요한 주소라면 메일함을 확인해 주세요.");
    expect(page.resend().props.disabled).toBe(true);
    page.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
