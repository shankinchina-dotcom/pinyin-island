# 部署手册（交接用）

这份文档写给接手发布的人。照着做，不需要理解前端代码。

- 线上地址：<https://pinyin.shankluo.cc>
- 项目目录：`pinyin-island/`
- 最后更新：2026-11-21

---

## 1. 服务器事实清单

| 项目 | 值 |
|---|---|
| 云厂商 | 腾讯云轻量应用服务器 |
| 实例名 | Hermes Agent-N5fN（广州，2 核 4G） |
| 公网 IP | `139.199.173.105` |
| 系统 | Ubuntu（内核 6.8） |
| 登录用户 | `root` |
| 站点目录 | `/srv/pinyin-island`（1.8MB，静态文件） |
| 钥匙清单 | 服务器 `/srv/pinyin-island/access.json`，**不在仓库里**，由发布脚本单独上传 |
| 本地监听 | Caddy 在 `127.0.0.1:8080` 提供这个目录 |
| 对外入口 | Cloudflare Tunnel，`pinyin.shankluo.cc → 127.0.0.1:8080` |
| 同机其他服务 | `xdb.shankluo.cc → 127.0.0.1:3000`（投放看板，**不要动**） |

**没有开放任何公网端口**（80/8080 都被云防火墙挡着），所有流量走 Cloudflare Tunnel。所以不需要改防火墙，也不要用 IP 访问。

---

## 2. 一次发布只要一条命令

```bash
cd pinyin-island
./scripts/deploy.sh            # 只发前端
./scripts/deploy.sh --audio    # 前端 + 音频
```

脚本做的事：类型检查 → 构建 → 打包 → 上传 → 解包 → curl 验证返回 200。

构建产物每次落在 `.build-tmp/out-<时间戳>/`，不删除任何旧目录——本机安全策略会拦 `rm -rf`，
所以脚本刻意避开删除操作。`.build-tmp` 已在 `.gitignore` 里，磁盘满了可以手动清。

可用环境变量覆盖默认值：

```bash
SERVER=root@1.2.3.4 SSH_KEY=~/.ssh/my_key ./scripts/deploy.sh
```

Windows 上用 **Git Bash** 跑（不要用 cmd/PowerShell 直接跑 .sh）。

---

## 3. 手动发布（脚本不可用时）

```bash
# 1. 构建到临时目录（不要直接 build 到 dist，见第 6 节）
npx tsc -b
npx vite build --outDir /tmp/pi-out --emptyOutDir

# 2. 打包
cd /tmp/pi-out && tar czf /tmp/pi.tgz index.html assets

# 3. 上传
scp -i ~/.ssh/pinyin_deploy /tmp/pi.tgz root@139.199.173.105:/tmp/

# 4. 解包（先删旧 assets，避免旧 hash 文件堆积）
ssh -i ~/.ssh/pinyin_deploy root@139.199.173.105 \
  "cd /srv/pinyin-island && rm -rf assets && tar xzf /tmp/pi.tgz"

# 5. 验证
curl -s -o /dev/null -w '%{http_code}\n' https://pinyin.shankluo.cc/
```

钥匙清单改动后（`public/access.json`）直接跑一次 `./scripts/deploy.sh` 即可同步，
脚本会把它单独 scp 到站点根目录，不参与前端打包。

音频单独发：

```bash
tar czf /tmp/audio.tgz -C public audio/v1
scp -i ~/.ssh/pinyin_deploy /tmp/audio.tgz root@139.199.173.105:/tmp/
ssh -i ~/.ssh/pinyin_deploy root@139.199.173.105 \
  "cd /srv/pinyin-island && tar xzf /tmp/audio.tgz && find audio/v1 -name 'tmp_*' -delete"
```

---

## 4. 回滚

静态站点没有版本号，回滚靠备份：

```bash
ssh -i ~/.ssh/pinyin_deploy root@139.199.173.105
ls /srv/pinyin-island.bak-*          # 若之前建过备份目录
```

建议每次大改前先备份：

```bash
ssh -i ~/.ssh/pinyin_deploy root@139.199.173.105 \
  "cp -a /srv/pinyin-island /srv/pinyin-island.bak-$(date +%Y%m%d-%H%M)"
```

Caddy 与 tunnel 的配置备份在服务器上：

- `/etc/caddy/Caddyfile.bak-*`
- `/root/.cloudflared/config.yml.bak-*`

---

## 5. 密钥：怎么给下一个人

现在服务器上有一把部署专用公钥，注释是 `pinyin-island-deploy`，对应私钥在本机 `~/.ssh/pinyin_deploy`。

**推荐做法：让接手的人自己生成一把，不要传私钥。**

1. 他在自己电脑上执行：

   ```bash
   ssh-keygen -t ed25519 -N "" -C "pinyin-island-deploy-<他的名字>" -f ~/.ssh/pinyin_deploy
   ```

2. 他把 `~/.ssh/pinyin_deploy.pub` 的内容发给你 / 贴到服务器：

   ```bash
   # 在服务器上执行（把整行公钥粘进引号里）
   echo "ssh-ed25519 AAAA... 名字" >> /root/.ssh/authorized_keys
   ```

3. 他用 `./scripts/deploy.sh` 就能发布。

**交接完成后建议删掉旧公钥**：编辑 `/root/.ssh/authorized_keys`，删掉注释为 `pinyin-island-deploy`（不带名字后缀）的那一行。

> 私钥等同于服务器密码。不要放进仓库、不要发微信群、不要写进文档。本项目 `.gitignore` 已排除 `*.local`，但密钥本来就不该出现在项目目录里。

如果没有服务器密码，只能通过腾讯云控制台的「自动化助手」执行命令（本项目就是这样写入第一把公钥的）：

- 控制台 → 轻量应用服务器 → 自动化助手 → 命令列表 → 创建命令
- 命令类型 SHELL，执行用户 `root`，内容就是上面那条 `echo ... >> authorized_keys`

---

## 6. 已知的坑

**① 不要直接 `npm run build`**

Vite 默认会先清空 `dist/`，本机的沙箱安全策略会把它当成批量删除拦下来。所以脚本里构建到 `/tmp` 的临时目录，再从那里打包。想本地看 dist 的话：

```bash
unset CODEBUDDY_SAFE_DELETE_SANDBOX && npm run build
```

**② tar 会打印 “time stamp in the future”**

Windows 与服务器有时钟偏差，解包时会警告，不影响结果，忽略即可。

**③ 音频换了但页面还是旧声音**

浏览器和 Cloudflare 都会缓存。播放器已经给音频地址加了内容指纹（`?h=<sha256前8位>`），所以只要 `manifest.json` 更新，URL 就会变。如果仍听到旧音，强制刷新一次。

**④ 改了 Caddy 配置要 reload，不是 restart**

```bash
caddy validate --config /etc/caddy/Caddyfile   # 先验证
systemctl reload caddy                          # 平滑生效
```

`Caddyfile` 里 `:8080` 那个块就是本项目，别动 `:80` 和别人的配置。

**⑤ Cloudflare Tunnel 已交给 systemd 托管**

服务名 `cloudflared`，已 `enable`，服务器重启会自动恢复。改配置后：

```bash
systemctl restart cloudflared
systemctl status cloudflared --no-pager
```

（历史上它是裸进程，重启不会自愈；2026-11-21 已改为 systemd。）

**⑥ 手机端布局**

390px 宽度下验证过。改样式后建议用 Chrome DevTools 的设备模拟看一眼，不要只看桌面。

---

## 7. 加一个新站点（如果以后要）

1. 在 `/etc/caddy/Caddyfile` 追加：

   ```
   :8081 {
       root * /srv/新目录
       file_server
   }
   ```

2. `caddy validate` + `systemctl reload caddy`
3. 在 `/root/.cloudflared/config.yml` 的 `ingress` 里，**加在最后那条 `http_status:404` 之前**：

   ```yaml
     - hostname: 新域名.shankluo.cc
       service: http://127.0.0.1:8081
   ```

4. 建 DNS：`cloudflared tunnel route dns a958aace-8c57-438d-bd2c-6e49313c8a1f 新域名.shankluo.cc`
5. `systemctl restart cloudflared`，再 `curl` 验证

---

## 8. 一分钟自检

```bash
curl -s -o /dev/null -w 'site:%{http_code}\n' https://pinyin.shankluo.cc/
ssh -i ~/.ssh/pinyin_deploy root@139.199.173.105 \
  "systemctl is-active caddy cloudflared; curl -s -o /dev/null -w 'local:%{http_code}\n' http://127.0.0.1:8080/"
```

两个 200 就是正常。出现问题按顺序查：Caddy → tunnel → Cloudflare DNS。
