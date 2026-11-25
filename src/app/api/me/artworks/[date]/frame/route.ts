import { artworkFramePut } from "@/server/artwork-handlers";
export async function PUT(request:Request,ctx:{params:Promise<{date:string}>}) { return artworkFramePut(request,(await ctx.params).date); }
