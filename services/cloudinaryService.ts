
export const uploadToCloudinary = async (
  file: File,
  cloudName: string,
  uploadPreset: string
): Promise<string> => {
  if (!cloudName || !uploadPreset) {
    throw new Error("Cloudinary cloud name or upload preset is not configured.");
  }

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Cloudinary upload failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.secure_url) {
      throw new Error("Cloudinary response did not include a secure_url.");
    }

    return data.secure_url;
  } catch (error: any) {
    console.error("Cloudinary upload error:", error);
    throw new Error(`Failed to upload to Cloudinary: ${error.message}`);
  }
};
