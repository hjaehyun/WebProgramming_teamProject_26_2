import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cronAuthorized: vi.fn(), aiConfigured: vi.fn(), processOne: vi.fn(), purgeExpiredTrash: vi.fn(), purgeAllExpiredTrash: vi.fn(), cartoonJob: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/core/http", () => ({ cronAuthorized: mocks.cronAuthorized }));
vi.mock("@/server/core/ai", () => ({ aiConfigured: mocks.aiConfigured }));
vi.mock("@/server/core/jobs", () => ({ processOne: mocks.processOne }));
vi.mock("@/server/trash-purge", () => ({ purgeExpiredTrash: mocks.purgeExpiredTrash, purgeAllExpiredTrash: mocks.purgeAllExpiredTrash }));
vi.mock("@/server/cartoon-handlers", () => ({ cartoonJob: mocks.cartoonJob }));
import { POST } from "../src/app/api/jobs/route";
import { GET as dailyGet } from "../src/app/api/cartoon-jobs/route";

describe("the daily cron, which runs even when no picture is waiting", () => {
  test("purges all expired trash before the cartoon work, only when authorized", async () => {
    mocks.cartoonJob.mockResolvedValue(new Response("{}", { status: 200 })); mocks.purgeAllExpiredTrash.mockResolvedValue({ artworks: 0, entries: 0 });
    mocks.cronAuthorized.mockReturnValue(true);
    expect((await dailyGet(new Request("http://127.0.0.1:3001/api/cartoon-jobs"))).status).toBe(200);
    expect(mocks.purgeAllExpiredTrash).toHaveBeenCalledTimes(1); expect(mocks.cartoonJob).toHaveBeenCalledTimes(1);
    mocks.cronAuthorized.mockReturnValue(false);
    await dailyGet(new Request("http://127.0.0.1:3001/api/cartoon-jobs"));
    expect(mocks.purgeAllExpiredTrash).toHaveBeenCalledTimes(1); expect(mocks.cartoonJob).toHaveBeenCalledTimes(2);
  });
  test("a purge failure still runs the cartoon work", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.cronAuthorized.mockReturnValue(true); mocks.purgeAllExpiredTrash.mockRejectedValue(new Error("db down"));
    mocks.cartoonJob.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await dailyGet(new Request("http://127.0.0.1:3001/api/cartoon-jobs"))).status).toBe(200);
  });
});

const call = () => POST(new Request("http://127.0.0.1:3001/api/jobs", { method: "POST" }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cronAuthorized.mockReturnValue(true); mocks.aiConfigured.mockReturnValue(true);
  mocks.processOne.mockResolvedValue({ processed: false }); mocks.purgeExpiredTrash.mockResolvedValue({ artworks: 0, entries: 0 });
});

describe("job worker and the trash", () => {
  test("each authorized run also purges expired trash, even without image AI", async () => {
    expect((await call()).status).toBe(200);
    expect(mocks.purgeExpiredTrash).toHaveBeenCalledTimes(1);
    mocks.aiConfigured.mockReturnValue(false);
    expect((await call()).status).toBe(503);
    expect(mocks.purgeExpiredTrash).toHaveBeenCalledTimes(2);
  });
  test("a purge failure never stops the drawing work", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.purgeExpiredTrash.mockRejectedValue(new Error("db down"));
    const r = await call();
    expect(r.status).toBe(200); expect(mocks.processOne).toHaveBeenCalledTimes(1);
  });
  test("an unauthorized call does nothing", async () => {
    mocks.cronAuthorized.mockReturnValue(false);
    expect((await call()).status).toBe(401);
    expect(mocks.purgeExpiredTrash).not.toHaveBeenCalled();
  });
});
