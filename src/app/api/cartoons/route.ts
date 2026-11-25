import { cartoonsGet, cartoonsPost } from "@/server/cartoon-handlers";
export const runtime = "nodejs";
export const maxDuration = 300;
export const GET = cartoonsGet;
export const POST = cartoonsPost;
