# dsh-my-go 开发沙箱指南

一句话：所有实验都在 `DSH_HOME=$HOME/<sandbox-home>` 的第二个家目录里做，
日常使用的 `~/.dsh` 只读不写；改完必还，还完必核 sha256。

本指南面向在本仓做改动、又不想污染自己常用实例的贡献者：照 §1 划好隔离边界，
按 §3 起一个沙盒宿主，用 §4 的清单验收，踩过的坑在 §5。

## 1. 隔离边界

| 面 | 日常实例（**不碰**） | 沙盒 |
| --- | --- | --- |
| 数据家目录 | `~/.dsh` | `$HOME/<sandbox-home>` |
| 端口 | 日常实例正在使用的端口 | **3086** |
| profile | `~/.dsh/profiles/web` | `…/<sandbox-home>/profiles/web` |
| 配置 | `~/.dsh/settings.yaml` + 两层 `cordis.patch.yml` | 同名的沙盒四件 |

本仓特有（0.1.7 起）：宿主半 apply **不再有任何 preset 安装动作**——预设由包内
`preset/agent.patch.yml` 声明行就地加载（旧安装同步器与它的家目录落点整体退役），
所以起沙盒宿主不会往家目录写 preset 副本，「四件基线」之外无隐藏脏源，本表也因此
不再有「preset 落点」这一面。

## 2. 装与核对

沙盒家目录早已 link 本仓（`profiles/web/package.json` 的
`"dsh-my-go": "link:<repo-root>"`——`<repo-root>` 即本仓绝对路径，形如
`$HOME/<workspace>/dsh-my-go`——外加 `dsh.profile.bundles`
含 `dsh-my-go`），日常改动**不需要重装**，改哪半刷哪半（见 §3、§7-h）。

要重装：

```bash
D="$HOME/<sandbox-home>"
R="$HOME/<workspace>/dsh-my-go"        # <repo-root>：本仓绝对路径
DSH_HOME="$D" dsh plugin --profile web add "$R"
DSH_HOME="$D" dsh plugin --profile web list      # 确认 dependencies 里有 dsh-my-go
```

**每一条 `dsh plugin` 都必须带 `DSH_HOME`**：它是 pnpm 转发，不带就在日常实例的
`~/.dsh/profiles/web` 上执行（连只读 `list` 都会往 `.plugin-manager/logs/` 落一个操作目录）。

核对两件事：

1. **依赖键 == 包名**（本仓两者都是 `dsh-my-go`）。官方插件页按 profile 的**依赖键**
   记账 bundle：依赖键用了目录别名时，只注册包名的卡一张都不出。本仓无此坑，
   但每次迁移都要照本条对照确认一遍。
2. `profiles/web/node_modules/dsh-my-go` 符号链接指向本仓。

## 3. 起宿主 / 停宿主

```bash
cd /tmp/<scratch-dir>
D="$HOME/<sandbox-home>"
setsid nohup env -u DSH_SESSION_ID -u DSH_WEB_URL -u DSH_SHELL -u DISPLAY \
  DSH_HOME="$D" DSH_TELEMETRY_DISABLED=1 dsh web --port 3086 --no-open > boot.log 2>&1 < /dev/null &
sleep 18
grep -icE 'error|fatal|exception' boot.log            # 期望 0
grep -o 'token=[A-Za-z0-9_-]*' boot.log | tail -1     # 登录 token
```

停：**先双向确认身份再 kill**，绝不按端口盲杀（日常实例的端口上跑着真宿主）：

```bash
for p in $(ss -ltnp | grep ':3086' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
  tr '\0' ' ' < /proc/$p/cmdline | grep -o 'web --port 3086 --no-open' && kill $p
done
```

## 4. 验收清单（配置面迁移）

| 行 | 判据 | 手法 |
| --- | --- | --- |
| a | 干净启动 | `boot.log` 里 `error\|fatal\|exception` 计数 0 |
| b | 命名空间在服务 | `POST /api/settings/describe` → `dsh-my-go` 在册、`base` = 行 config 的 settings 形状部分、`applies: live`、`schema` 可序列化 |
| c | 双轨/降级不塌 | 从沙盒 `settings.yaml` 整段删掉 `dsh-my-go:` → describe 仍 served、revision 前进、解析值回 schema 默认、`/dsh-my-go/snapshot` 名册回「跟随环境」、宿主零新增异常；随后整文件还原并确认热更回到基线绑定 |
| d | 非设置面不受牵连 | 面板 RPC `snapshot` / `listTools` / `getBuiltinPersona` / `getUsage` 全 `ok` |
| e | 退役端点确实不在 | `loadSettings` / `saveSettings` / `listModels` → `bad-request: unknown endpoint`；`bogus` 同形（负样本） |
| f | 配置卡出现在官方页 | DSH Web → 插件 → dsh-my-go → `[data-plugin-config]` 内是本卡；`getComputedStyle` 取证两列等宽、行高、省略号、通栏注释区、样式标签在场 |
| f′ | 旧入口负样本 | 设置侧栏无「MyGO 编排」（截图存证），产物内 `settings.section` grep 为 0 |
| g | 读写往返 | 新建角色 → 填链 → 保存 → 回执 + revision 前进 + `settings.yaml` 落该项 + snapshot 名册可见；删除 → 保存 → 整键消失。单价表同理（四桶落 number） |
| h | 客户端半活读 | 改 `src/*` → `node scripts/build-client.mjs` → 硬刷新即生效（宿主按请求读盘） |

面板 RPC 的信封（取证时手写 curl 要用）：

```bash
curl -s -b jar.txt -X POST -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r1","method":"snapshot","payload":{}}' \
  http://127.0.0.1:3086/dsh-my-go/snapshot
```

`method` 必须**逐字等于** URL 里的端点名，否则 `gateway/bad-request`。

## 5. 陷阱清单

1. **官方写路径整文件重写 `settings.yaml`，手写注释全丢**。沙盒那份若有手写注释，
   一次保存就变 0 条。所以：验收前 `cp -a settings.yaml /tmp/…orig`，验收后整文件还原，
   再核 sha256（不要只 diff 内容——注释丢失 diff 看不出来）。
2. **清空 ≠ 留空壳**：逐行 `unset` 会在用户层落下 `usagePrices: {}` 一行空字典；
   清空整表要发 `unset ['usagePrices']` 整键（现行规则）。
3. **缺省不许被钉住**：草稿里 `usageCurrency` 恒有值（缺省归一成 USD），照「显式携带
   就写」会把 `usageCurrency: USD` 永久钉进用户层，从此挡住 cordis 行的 base。
   现行规则：与宿主现值（含 schema 默认）同形就不发 op。
4. **官方 `scope.mutate` 被拒不抛**：它自己 `recover()` 重读后照常 resolve。
   任何用 `try/catch` 判「写失败/版本冲突」的写法都会把失败报成成功。
   唯一判据是写完读回比对（`writeLanded`）。
5. **栅栏带的是草稿建立那一刻的 revision**，不是保存时的最新值——带最新值等于
   自己把 TOCTOU 窗又开回来。
6. **受控输入要用浏览器自动化工具的「真值设置」能力**：content script 隔离世界里看不见
   React 的 value tracker，直接在 `evaluate` 里 `input.value=…` + `dispatchEvent('input')`
   会被吃掉。`<select>` 例外：用 `HTMLSelectElement.prototype` 的 value setter +
   `change` 事件可行。
7. **两次点击要分两次 evaluate**：同一次 evaluate 里连点两下，第二次常落在
   旧 fiber 上（React 还没重渲染）。
8. **自动化会话死得快**：报 `session not registered or already stopped` 就重开会话，
   别怀疑代码。
9. **受控输入的闭包吃的是那一次渲染的快照**：测试里连着敲两个格子必须**每次重查节点**，
   拿旧节点句柄连打两次，后一次会按旧链快照覆盖前一次（假 React 档里最容易踩）。
10. **别对日常实例发写请求**：日常实例的端口上跑着真实会话。所有 curl 都要盯紧
    `127.0.0.1:3086`，`ss -ltnp` 确认端口归属后再动手。
11. **沙盒配置若含真实凭据，勿提交**：动态改动只限自己另起的沙盒实例，改完必须整文件还原。

## 6. 还原核对

```bash
D="$HOME/<sandbox-home>"
cd "$D" && sha256sum settings.yaml cordis.patch.yml profiles/web/package.json profiles/web/cordis.patch.yml
grep -c "^ *#" settings.yaml            # 注释数回到基线
grep -c "验收期造出来的键名" settings.yaml  # 0
ss -ltn | grep ':3086' || echo "3086 已释放"
stat -c '%y %n' ~/.dsh/settings.yaml ~/.dsh/profiles/web/package.json   # mtime 均早于本次开工
```

## 7. 实测记录示例（配置面全量迁官方插件页 · a–h 全绿）

> 示例输出：只展示判据形状与方法，供复核对照。

```
a  boot.log 错误计数 0；preset 就地加载自包内 agent.patch.yml，家目录无 preset 副本
b  describe：served 含 dsh-my-go、base={}（行 config 无 settings 形状部分）、
   applies=live、revision 随写前进（r0→r7）、roles 解析出 5 行
c  删掉 settings.yaml 的 dsh-my-go 段（53 行）→ describe 仍 served、revision→1、roles 0、
   currency USD、sisyphus 解析成 {fallbacks:[]}；snapshot 名册 7 行且 hermes=「跟随环境」；
   宿主日志零新增错误。整文件还原后热更即时回到 acme·demo-model-001 chain=3
d  snapshot / listTools(26) / getBuiltinPersona / getUsage 全 ok
e  loadSettings / saveSettings / listModels → bad-request unknown endpoint（与 bogus 同形）
f  真浏览器：[data-plugin-config] 内两块 data-block=roles|prices，
   getComputedStyle → grid 461px 461px（页宽 960）、行高 24、rowName=ellipsis|nowrap|0px、
   列表框 258、detail 宽 934 且 previousElementSibling 就是 grid（通栏成立）、
   主按钮 rgb(15,17,21) on rgb(249,250,251)、style[data-plugin-css="dsh-my-go/settings.css"] 在 head
f′ 设置侧栏只剩 通用设置/模型/内置插件/Agent 预设，body 全文 grep 'MyGO 编排' = false
g  新建 sandbox-qc → 填 acme/demo-model-001 → 保存 → 回执「已保存，配置即时生效 · r3」、
   名册 9 行含自定义徽章、settings.yaml 落该行、snapshot roster 里 modelText=acme·demo-model-001；
   删除 → r4 该行整键消失。单价行新建 → 四桶填 1.5/6 → r5 落 number → 删除 → r6 整键撤掉
h  改 src/settings-ops.js → node scripts/build-client.mjs → location.reload() 即生效
i  最小写面复验（修完第 2/3 条陷阱后）：只改一个设置格 → 用户层只多出该条，
   且残留的 usagePrices: {} 被整键撤掉
```

截图：`/tmp/<scratch-dir>/01-config-card.png`（全景）、`02-settings-no-old-entry.png`（旧入口负样本）、
`03-after-save-role.png`（保存后名册）、`04-after-cleanup.png`（单价清空态）、
`05-final-minimal-write.png`（最终构建 + 最小写面）。

还原：沙盒四件 sha256 与开工前基线逐字节一致（四枚摘要各自相等即可，具体值不入库），
注释条数回归基线，验收期造的键零残留；沙盒端口已按 `/proc/<pid>/cmdline` 双向确认后 kill；
自动化会话已停；日常 `~/.dsh` 未被写入、无新增操作日志目录。
