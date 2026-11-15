import { songFeedbackPost } from "@/server/music";
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}) { return songFeedbackPost(request,(await ctx.params).id); }
