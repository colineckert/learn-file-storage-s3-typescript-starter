import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB
const allowedFileTypes = ["image/jpeg", "image/png"];

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError(
      "You don't have permission to modify this video",
    );
  }

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("No thumbnail file provided");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  if (!allowedFileTypes.includes(file.type)) {
    throw new BadRequestError("Unsupported file type for video thumbnail");
  }

  const fileName = randomBytes(32).toString("base64url");
  const extension = file.type.split("/")[1];
  const filePath = path.join(cfg.assetsRoot, `/${fileName}.${extension}`);
  const thumbnailURL = `http://localhost:${cfg.port}/${filePath}`;
  Bun.write(filePath, file);

  updateVideo(cfg.db, {
    ...video,
    thumbnailURL,
  });

  return respondWithJSON(200, { ...video, thumbnailURL });
}
