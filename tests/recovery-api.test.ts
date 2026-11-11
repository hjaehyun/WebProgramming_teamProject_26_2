import {afterEach,beforeEach,describe,expect,test,vi} from "vitest";
const mock=vi.hoisted(()=>({verifyOtp:vi.fn(),cookieSet:vi.fn(),cookieGet:vi.fn(),getClaims:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({cookies:async()=>({set:mock.cookieSet,get:mock.cookieGet})}));
vi.mock("../src/server/core/supabase/server",()=>({configured:()=>true,userClient:async()=>({auth:{verifyOtp:mock.verifyOtp}})}));
import {makeGrant,validGrant,requireRecovery} from "../src/server/recovery";
import {GET} from "../src/app/auth/confirm/route";
const key="test-only-server-key-with-sufficient-entropy";
const userId="user-1",sessionId="session-1",now=1794391200000;
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("APP_URL","http://127.0.0.1:3001");vi.stubEnv("SUPABASE_SECRET_KEY",key);
  mock.cookieGet.mockReturnValue(undefined);
  mock.verifyOtp.mockResolvedValue({data:{user:{id:userId},session:{access_token:`header.${Buffer.from(JSON.stringify({session_id:sessionId})).toString("base64url")}.signature`}},error:null});
});
afterEach(()=>{vi.unstubAllEnvs();});
describe("recovery grant binding",()=>{
  test("validates the same user and session, rejecting expiry, tampering and substitution",()=>{
    const grant=makeGrant(userId,sessionId,key,now);
    expect(validGrant(grant,userId,sessionId,key,now+1000)).toBe(true);
    expect(validGrant(grant,"someone-else",sessionId,key,now+1000)).toBe(false);
    expect(validGrant(grant,userId,"another-session",key,now+1000)).toBe(false);
    expect(validGrant(grant,userId,sessionId,key,now+600001)).toBe(false);
    expect(validGrant(grant+"x",userId,sessionId,key,now+1000)).toBe(false);
    expect(validGrant(grant,userId,sessionId,"different-key",now+1000)).toBe(false);
  });
  test("an ordinary authenticated session cannot use the password reset endpoint",async()=>{
    mock.getClaims.mockResolvedValue({data:{claims:{session_id:sessionId}},error:null});
    await expect(requireRecovery({auth:{getClaims:mock.getClaims}} as any,userId)).rejects.toMatchObject({status:403});
  });
});
describe("existing production email template callback",()=>{
  test("a verified recovery link binds an HttpOnly grant and redirects to reset",async()=>{
    const res=await GET(new Request("http://127.0.0.1:3001/auth/confirm?type=recovery&token_hash=test-token&next=https://evil.invalid"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3001/reset-password");
    expect(mock.verifyOtp).toHaveBeenCalledWith({type:"recovery",token_hash:"test-token"});
    const grantCall=mock.cookieSet.mock.calls.find(c=>c[0]==="haru_password_recovery" && c[1]);
    expect(grantCall).toBeDefined();expect(grantCall![2]).toMatchObject({httpOnly:true,maxAge:600,path:"/api/auth/reset-password"});
    expect(validGrant(grantCall![1],userId,sessionId,key)).toBe(true);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
  test("email confirmation does not grant password recovery",async()=>{
    const res=await GET(new Request("http://127.0.0.1:3001/auth/confirm?type=email&token_hash=test-token"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3001/today");
    expect(mock.cookieSet.mock.calls.some(c=>c[0]==="haru_password_recovery" && c[1])).toBe(false);
  });
  test("expired recovery and unsupported token types get fixed safe destinations",async()=>{
    mock.verifyOtp.mockResolvedValue({data:{},error:{message:"private expired token error"}});
    const res=await GET(new Request("http://127.0.0.1:3001/auth/confirm?type=recovery&token_hash=expired"));
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3001/forgot-password?error=expired");
    mock.verifyOtp.mockClear();
    const invalid=await GET(new Request("http://127.0.0.1:3001/auth/confirm?type=invite&token_hash=anything"));
    expect(mock.verifyOtp).not.toHaveBeenCalled();expect(invalid.headers.get("location")).toBe("http://127.0.0.1:3001/?error=confirmation");
  });
});
