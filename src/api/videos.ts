import { respondWithJSON } from './json';
import { type ApiConfig } from '../config';
import type { BunRequest } from 'bun';
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors';
import { getBearerToken, validateJWT } from '../auth';
import { getVideo, updateVideo } from '../db/videos';
import path from 'path';
import { randomBytes } from 'crypto';
import fs from 'fs';

const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  // TODO: same code used in handlerUploadThumbnail - can be extracted
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError('Invalid video ID');
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError(
      "You don't have permission to modify this video"
    );
  }

  const formData = await req.formData();
  const file = formData.get('video');

  if (!(file instanceof File)) {
    throw new BadRequestError('No video file provided');
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Video file is too large');
  }

  if (file.type !== 'video/mp4') {
    throw new BadRequestError('Unsupported file type for video');
  }

  const name = randomBytes(32).toString('base64url');
  const extension = file.type.split('/')[1];
  const fileName = `${name}.${extension}`;
  const filePath = path.join(cfg.assetsRoot, fileName);
  await Bun.write(filePath, file);

  try {
    const body = Bun.file(filePath);
    await cfg.s3Client.write(fileName, body, {
      type: file.type,
    });

    const updatedVideo = {
      ...video,
      videoURL: `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}`,
    };
    updateVideo(cfg.db, updatedVideo);

    return respondWithJSON(200, updatedVideo);
  } finally {
    if (fs.existsSync(filePath)) {
      fs.rm(filePath, (err) => {
        if (err) {
          console.error(err.message);
          return;
        }
      });
    }
  }
}
