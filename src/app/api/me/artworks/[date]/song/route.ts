import { songPost } from "@/server/music";
export async function POST(request:Request,ctx:{params:Promise<{date:string}>}) { return songPost(request,(await ctx.params).date); }
