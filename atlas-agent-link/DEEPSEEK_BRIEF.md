# 任务书:Atlas VTT 的 AI 全面接入与控制层(给 DeepSeek / dsh)

工作目录:`<repo>`
语言:TypeScript(Node 22+),产物是一个 Obsidian 桌面插件。
你直接在用户的电脑上,所以**可以真的在 Obsidian + Atlas VTT 里验证**。这是本任务和之前原型的最大区别,务必利用。

---

## 1. 背景与目标

用户(用户)在做 AI 主播(角色 Helixus),问题是主播太被动。方案是让多个 AI agent 在一个**可视化虚拟跑团桌面**上跑团,主播当 GM/解说并回应观众。可视化桌面选定 **Atlas VTT**(Obsidian 插件,v0.8.0,AGPL-3.0-only,PIXI 渲染,zustand+immer store,场景文件 `.atlasmap`,有独立玩家窗口)。

**目标**:做一个"MCP 式"的机构,让 AI 能**读取并控制 Atlas 的几乎全部场景状态**(token、迷雾、墙/门/光源、先攻/战斗、骰子、镜头、开场景、推送到玩家窗口),并向外**推送事件流**,供主播编排层(另一个 TypeScript 项目 编排层)监听。

Atlas **没有公开 API**(官方 extension API 未发布)。现成的 `olaf4343/atlas-vtt-mcp-bridge` 只覆盖素材/设置/玩家端图片/命令/图鉴,碰不到场景内容,只测过 Atlas 0.4.2。所以走 **store 层**:每个 Atlas 视图有 `AtlasView.getStore()`(zustand,subscribeWithSelector + persist + immer + history/temporal),界面上所有操作都是 store action;每次写入是一步撤销;持久化自动防抖保存。

## 2. 已有原型(起点,不是成品)

用户会把 `atlas-agent-link.zip` 解压到 `atlas-agent-link\`。结构:

```
manifest.json  esbuild.mjs  tsconfig.json  README.md
src/main.ts            插件入口、设置页、命令、store 订阅→事件
src/atlas/adapter.ts   所有 Atlas 内部依赖都集中在这(找视图/store、act(name,...args)、openScene、runCommand)
src/tools.ts           20 个 MCP 工具定义 + atlas_apply 白名单
src/mcp/server.ts      手写 MCP JSON-RPC(initialize/tools/list/tools/call/ping,通知返回 202)
src/http.ts            127.0.0.1 HTTP:POST /mcp、GET /events(SSE,Last-Event-ID 重放)、Bearer token、Host/Origin 校验、限速
src/events.ts          EventBus(环形缓冲)+ diffState(按 id 集合 diff)
src/util.ts            sanitize(去函数/环/限深)、getPath、rollFormula(代码侧掷骰)
test/core.test.ts      9 个单测,只对**假 store** 跑过
```

**诚实声明**:原型从未在真实 Atlas 0.8.0 里运行过。action 名和数据结构来自读源码,可能有误。你的第一要务是用真实环境验证并修正它。

## 3. 你的工作步骤(按顺序)

1. **环境**:确认 Obsidian 与 Atlas VTT 0.8.0 已装(`<vault>\.obsidian\plugins\atlas-vtt\manifest.json`)。若没有 vault,建一个测试 vault 并装 Atlas,放一个 `.atlasmap` 场景。向用户要 vault 路径,不要猜。
2. **构建并装载原型**:`npm i && npm test && npm run build`,把 `main.js` + `manifest.json` 放进 `<vault>\.obsidian\plugins\atlas-agent-link\`,启用,设置里打开写入。可用 `devtools`(Ctrl+Shift+I)或 Obsidian CLI/Local REST 之类手段观察。
3. **探测真相(核心)**:在 Obsidian 开发者控制台里直接查:
   - `app.plugins.plugins['atlas-vtt']`、`app.workspace.getLeavesOfType('atlas-vtt')[0].view.getStore().getState()`。
   - 列出所有函数型 key(= 真实 action 名)和数据 key(= 真实状态形状:tokens/fog/walls/doors/lights/initiative/grid/camera/dice 日志在哪、是数组还是以 id 为键的对象)。
   - 把结果写入 `docs/PROBE.md`(版本号、action 名表、状态形状、与第 4 节契约的差异)。
4. **按真实形状修正**`src/tools.ts` 和 `adapter.ts`:
   - `atlas_cell_to_world` 里的网格信息现在是猜的(`state.grid/gridConfig/gridSettings`),改成真实位置;处理方形网格与六边形网格(六边形用 Atlas 自己的 `grid/gridPlacement` 逻辑,不要自造)。
   - `atlas_remove_token`、`atlas_initiative end`、`atlas_undo`、`addDiceLogEntry` 的参数形状目前是猜测,逐个核对。
   - 补全未覆盖的能力:墙/门/光源的增删改、迷雾操作的查询与撤销、token 分组/堆叠、`setInitiativeTrackerOpen` 等。优先做**有类型的专用工具**,`atlas_apply` 只作兜底白名单。
5. **玩家窗口同步**:验证通过 store 改动后,玩家窗口是否同步;`atlas-vtt:send-map-to-player-view`、`open-player-window` 命令是否可经 `app.commands.executeCommandById` 调用。
6. **端到端测试**:用 MCP 客户端(例如 Claude Code:`claude mcp add --transport http atlas http://127.0.0.1:27125/mcp --header "Authorization: Bearer <token>"`,或写个 Node 脚本)实际执行:开场景→加 3 个 token→移动→加条件→揭示迷雾→开战斗→下一回合→掷骰;每步在 Atlas 界面上**肉眼/截图确认**,再 `atlas_undo` 确认可撤销。同时用 `curl -N` 订阅 `/events` 确认事件。
7. **事件质量**:`state_changed` 现在是通用 diff。改成语义事件:`token_added/moved/removed/updated`、`fog_changed`、`door_toggled`、`initiative_changed`、`turn_changed`、`dice_rolled`、`scene_opened/closed`,每个带 id、前后值摘要,供主播解说。保留通用 diff 作兜底。
8. **加固**:见第 6 节。写 `docs/INTEGRATION.md`,说明给 编排层的接法(MCP 端点 + SSE)。
9. 全程保持 `npm test` 通过;为每个修正过的工具补**基于真实形状的** fixture 测试(把真实 state 快照存为 fixture)。

## 4. Atlas 内部契约(来自读源码,需验证)

仓库 `github.com/atlas-vtt/atlas-vtt`(commit 3d68221 附近)。可读文件:`main.ts`、`src/app/atlas-view.ts`、`src/app/storeFactory.ts`(action 的权威清单)、`src/app/stores/{mapObjectsSlice,initiativeSlice,tokenStacking,history}.ts`、`src/app/types/{viewState,fogTypes,gridTypes,diceTypes,initiativeTypes}.ts`、`src/app/tools/diceFormula.ts`、`src/app/grid/gridPlacement.ts`、`src/app/plugin/registerCommands.ts`。另有 232 KB 的 `CLAUDE.md` 架构文档,**先读它**。

已知 store action(签名待验证):
`addToken(data: TokenInput): string` · `moveToken(id,x,y)` · `updateToken(id, updates)` · `setTokensCondition(tokenIds, conditionId, active)` · `addFogOperation(FogOperationInput): string` · `toggleDoor(id)` · `addToInitiative(entry): string` · `rollAllInitiative(roll?, fromStatblocks?)` · `nextTurn()` · `startCombat(rules?)` · `addDiceLogEntry(entry: DiceRollResult)` · `setCamera(partial)` · `setInitiativeTrackerOpen(bool)`。

其他事实:
- token 坐标是**中心点的世界像素**;奇数直径的 token 落在格子中心,偶数占位偏半格;六边形有专门偏移。格子 (col,row) 中心 ≈ `(offsetX+(col+0.5)*size, offsetY+(row+0.5)*size)`。
- `AtlasView` 有 `getStore()`、`tabMetaStore`、`serviceManager`、`switchToTab`、`onLoadFile(file)`、`reloadActiveScene(rewrite)`、`saveMap()`。
- 持久化仅在 `persistenceEnabled && mapLoaded` 时防抖写入;`store.flushStorage()` 可强制落盘。
- 主插件对外暴露:`settingsService`、`widgetSyncService`、`globalAssetManager`、getter `presentedScene`、`tableChat`(后者仅联机时有)。
- 3D 骰子动画的 API 未知。当前方案:**代码侧掷骰**(LLM 会作弊)+ `addDiceLogEntry` 写日志。若你能找到触发 Atlas 骰子动画的办法,更好。
- 官方 extension API 未发布(`atlas-physical-dice`、`atlas-vtt-connect` 的 README 提到);有 beta 分支。可以看看其中有没有可用的扩展点,若有则**优先使用官方扩展点**,内部 store 作为后备。

## 5. 工具清单(目标形态)

读:`atlas_probe`、`atlas_list_scenes`、`atlas_get_scene`(支持 path/maxDepth/maxItems)、`atlas_events`、`atlas_call_log`、(新增)`atlas_screenshot`(如能从 PIXI renderer / 窗口抓图,供视觉模型和主播用;抓不到就说明原因)。
写:`atlas_open_scene`、`atlas_add_token`、`atlas_move_token`、`atlas_update_token`、`atlas_remove_token`、`atlas_set_condition`、`atlas_fog`、`atlas_toggle_door`、`atlas_initiative`、`atlas_roll_dice`、`atlas_set_camera`、`atlas_command`、`atlas_undo`、`atlas_apply`;(新增)墙/门/光源工具、token 分组、先攻条目增删改。
所有写工具带 `write: true`,只读模式下被拒。工具描述要写给 LLM 看:参数单位(世界像素 vs 格)、返回的 id、常见错误。

## 6. 安全与约束(不要放松)

- 只监听 `127.0.0.1`;Bearer token;校验 Host(防 DNS rebinding);拒绝带 Origin 的浏览器请求;限速;请求体上限。
- **默认只读**;写入需用户在设置里开启;"停止服务"命令是急停。
- `atlas_apply` 白名单 + 拒绝正则(clear/reset/import/storage/persist/destroy…),`atlas_command` 只允许 `atlas-vtt:` 前缀。
- 不得读写 vault 里 Atlas 之外的文件;不要通过本插件暴露 `app` 的任意方法。
- 绝不在测试里改动用户的真实场景文件:只用测试 vault,或先复制 `.atlasmap`。
- 协议:Atlas 是 AGPL-3.0,本插件也用 AGPL-3.0(加 LICENSE 文件)。这不是法律意见。
- 内部 API 会随 Atlas 更新而变:`adapter.ts` 是唯一碰内部的地方,加版本检测,不认识的版本给出明确警告而不是静默出错。

## 7. 验收标准

1. 真实 Atlas 0.8.0 中,第 3 节第 6 步的整套流程全部成功,并附 `docs/E2E.md`(每步的请求、响应、界面确认说明)。
2. `docs/PROBE.md` 记录了真实 action/状态形状;原型里所有"猜测"项要么已验证要么明确标注"未验证"。
3. `npm test` 通过,且含真实快照 fixture 测试。
4. 只读模式下任何写工具都失败;kill switch 生效;未带 token 请求被拒。
5. SSE 事件语义化,断线用 Last-Event-ID 能补发。
6. 最终报告:做了什么、没做到什么(尤其是截图、骰子动画、六边形网格)、已知风险。不要夸大;没验证的就写没验证。

## 8. 工作方式

- 先读 `CLAUDE.md`(Atlas 仓库)和上面列的源码,再动手;遇到与本文冲突的事实,以真实环境为准并更新 `docs/PROBE.md`。
- 小步提交,每步可运行。不确定 vault 路径、是否可重启 Obsidian 时问用户,不要猜。
- 本任务只做 Atlas 控制层;主播编排、Unity 舞台不在范围内。
