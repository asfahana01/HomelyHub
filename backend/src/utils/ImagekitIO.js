// ---- where user photos are stored ----
// Images are NOT kept in our database. We send them to
// ImageKit and save only the link they give back.
import ImageKit from "imagekit";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

let imagekitInstance;

const getImageKit = () => {
  if (imagekitInstance) {
    return imagekitInstance;
  }

  const { IMAGE_PUBLICKEY, IMAGE_PRIVATEKEY, IMAGEKIT_URLENDPOINT } =
    process.env;

  if (!IMAGE_PUBLICKEY || !IMAGE_PRIVATEKEY || !IMAGEKIT_URLENDPOINT) {
    throw new Error("ImageKit environment variables are not configured.");
  }

  imagekitInstance = new ImageKit({
    publicKey: IMAGE_PUBLICKEY,
    privateKey: IMAGE_PRIVATEKEY,
    urlEndpoint: IMAGEKIT_URLENDPOINT,
  });

  return imagekitInstance;
};

const imagekit = {
  upload: (...args) => getImageKit().upload(...args),
};

export default imagekit;
