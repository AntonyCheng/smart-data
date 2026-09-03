/** 上传文件的公开视图。不暴露 opencode / 服务器路径。 */
export interface FileView {
  id: string;
  name: string; // original_name
  mimeType: string;
  size: number;
  createdAt: Date;
}
