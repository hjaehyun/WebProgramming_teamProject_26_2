import { artworkGet } from "@/server/artwork-handlers";
export async function GET(_request:Request,ctx:{params:Promise<{date:string}>}) { return artworkGet((await ctx.params).date); }
