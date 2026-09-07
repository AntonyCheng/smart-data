FROM node:22-bookworm-slim

# 系统依赖：LibreOffice（verify_xlsx / verify_docx 的 PDF 渲染自检）、CJK 字体、ripgrep、Python 运行时
# apt 走阿里云镜像（deb.debian.org 在国内网络极慢；中科大镜像近期对大包偶发丢连接）。
# Acquire::Retries 让个别包下载失败时自动重试，而不是整层 exit 100。
# CJK 字体用文泉驿正黑（~8 MB）而非 fonts-noto-cjk（~120 MB 单包，最易在慢镜像上超时）——
# LibreOffice 的 PDF 自检只需要一套不出豆腐块的中文字体即可。
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list.d/debian.sources \
 && printf 'Acquire::Retries "8";\nAcquire::http::Timeout "60";\n' > /etc/apt/apt.conf.d/80retries \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      python3 python3-pip python3-venv \
      libreoffice-calc libreoffice-writer \
      fonts-wqy-zenhei \
      ripgrep \
      libgcc-s1 libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# Python 分析栈（huashu-excel 清洗 / 制图 / 报告阶段依赖）
RUN pip3 install --break-system-packages --no-cache-dir --retries 5 --timeout 120 \
      -i https://pypi.tuna.tsinghua.edu.cn/simple \
      openpyxl pandas matplotlib Pillow

# OpenCode CLI —— 走 npm，自动拿 glibc 版二进制（ghcr 官方镜像是 musl，在 Debian 上跑不起来）
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
    NPM_CONFIG_FETCH_RETRIES=5
RUN npm install -g opencode-ai@1.18.18 && opencode --version

WORKDIR /app/services/excel-agent
COPY services/excel-agent /app/services/excel-agent

ENV OPENCODE_SERVER_USERNAME=opencode
ENV OPENCODE_SERVER_PASSWORD=change-me

EXPOSE 4096
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
