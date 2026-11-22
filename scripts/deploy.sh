#!/usr/bin/env bash
# 拼音岛发布脚本
#
# 用法：
#   ./scripts/deploy.sh                 # 只发前端（index.html + assets）
#   ./scripts/deploy.sh --audio         # 连音频一起发
#
# 环境变量：
#   SERVER   默认 root@139.199.173.105
#   SSH_KEY  默认 ~/.ssh/pinyin_deploy
#
# 依赖：node/npm、ssh、scp、tar（Windows 用 Git Bash）

set -euo pipefail

SERVER="${SERVER:-root@139.199.173.105}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pinyin_deploy}"
REMOTE_DIR="/srv/pinyin-island"
WITH_AUDIO=0
[ "${1:-}" = "--audio" ] && WITH_AUDIO=1

cd "$(dirname "$0")/.."

echo "==> 类型检查"
npx tsc -b

echo "==> 构建"
# 用项目内的相对路径，避免 Windows 盘符被 tar 当成远程主机；
# 每次用新目录，避开本机「安全删除」守卫对 rm -rf 的拦截
STAMP="$(date +%s)"
OUT=".build-tmp/out-$STAMP"
DIST=".build-tmp/dist-$STAMP.tgz"
mkdir -p "$OUT"
npx vite build --outDir "$OUT" --emptyOutDir false

echo "==> 打包"
tar czf "$DIST" -C "$OUT" index.html assets
if [ "$WITH_AUDIO" = "1" ]; then
  tar czf ".build-tmp/audio-$STAMP.tgz" -C public audio/v1
fi

if [ ! -f public/access.json ]; then
  echo "!! 缺少 public/access.json（钥匙清单），线上将无法登录"
  echo "   可复制 public/access.example.json 后修改"
fi

echo "==> 上传"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$DIST" "$SERVER:/tmp/pinyin-dist.tgz"
[ "$WITH_AUDIO" = "1" ] && scp -i "$SSH_KEY" -o StrictHostKeyChecking=no ".build-tmp/audio-$STAMP.tgz" "$SERVER:/tmp/pinyin-audio.tgz"

# 钥匙清单单独同步：它不在仓库里，也不打进 JS
if [ -f public/access.json ]; then
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no public/access.json "$SERVER:/tmp/access.json"
fi

echo "==> 解包"
ssh -i "$SSH_KEY" "$SERVER" "cd $REMOTE_DIR && rm -rf assets && tar xzf /tmp/pinyin-dist.tgz && if [ -f /tmp/pinyin-audio.tgz ]; then tar xzf /tmp/pinyin-audio.tgz; rm -f /tmp/pinyin-audio.tgz; fi && find audio/v1 -name 'tmp_*' -delete && if [ -f /tmp/access.json ]; then mv /tmp/access.json access.json; fi && echo ok"

echo "==> 线上验证"
CODE=$(curl -s -o /dev/null -w '%{http_code}' https://pinyin.shankluo.cc/)
echo "HTTP $CODE"
[ "$CODE" = "200" ] || { echo "发布后访问异常，检查 Caddy 与 cloudflared 状态"; exit 1; }

echo "完成：https://pinyin.shankluo.cc"
