# LICENSES — 正式跑团 vault 的素材许可证

> **公开仓库说明**：下面登记的是作者本地完整 vault 里用过的素材。这个仓库里**没有**任何图片 / 二进制，第三方素材（地图、token、立绘、官方模组资料）都要你自己准备；凡是写着“未核实”的，不要当成可以商用或再发布。

最后更新：2026-10-19（加了凡达林模组配套的 token 包和官方地图，都未核实许可；前一天：凡达林开场用的地图、两位新角色的立绘）

> 这个 vault 里的东西会出现在**有收益的 B 站直播**里。每一份第三方素材都要在这里记：
> 来源 URL、作者、许可证原文摘要、能不能商用直播、能不能再发布。
> **没核实过的写「未核实」，不要当成可以商用。**

## 1. 当前 vault 里实际使用的素材

| 素材 | 来源 / 作者 | 许可证 | 商用直播 | 再发布 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `assets/maps/crashed-ship-{deck,hold,cave}.png` | 本项目生成（`trpg-table/scripts/make_placeholder_assets.py`） | CC-BY-4.0（原创占位图） | ✅ | ✅ | **占位图**，正式直播前可换成用户选定的地图；替换后要在这里登记 |
| `assets/tokens/*.png` | 本项目生成（同上脚本） | CC-BY-4.0 | ✅ | ✅ | 占位 token 图 |
| `scenes/crashed-ship-*.atlasmap` | 本项目生成（基于测试场景的空白结构） | 本项目原创 | ✅ | ✅ | 空白地图；token 由 trpg-table 写入 |
| 剧本 `adventures/crashed-ship/**` | 本项目原创（GM 大纲由 Claude/本会话起草） | CC-BY-4.0 | ✅ | ✅ | 用户审过后再用；不是 WotC 模组 |
| 角色卡 `characters/*.json` | 本项目原创草稿 | CC-BY-4.0 | ✅ | ✅ | **人设要用户定稿** |
| SRD 数据（武器/法术/怪物数值） | Wizards of the Coast, SRD 5.1 | CC-BY-4.0 | ✅ | ✅ | 见下方署名 |
| `resource_pack/Forest road.zip`、`Forest camp.zip`（解开的 jpg 也在里面），以及从它们做出来的 `assets/maps/phandalin-*` | Manea Roliste（https://manea.itch.io/forest-road-map-pack 、…/forest-camp-battlemaps） | 搜索摘要转述：CC BY-NC 4.0，另有创作者自己写的 "I authorize them utilisation for monetized streams and videos, like on Twitch and YouTube"。**zip 里没有许可证文件，页面原文这边读不到（代理连不上 itch.io），用户 下载时在页面上看过没有，未记录** | ⚠️ 只在创作者页面声明的"收费直播和视频"范围内；其它商用要联系作者 | ❌ 不要把图再发布 | 署名（CC BY）：写 "Maps by Manea Roliste"。页面截图 / 声明原文请 用户 存一份 |
| `assets/maps/phandalin-cave-*`（来自 `incoming/dyson-deep-sepulchre/`） | Dyson Logos「The Deep Sepulchre」，https://dysonlogos.blog/2023/09/16/deep-sepulchre/ | 页面原文："This map is made available to you under a free license for personal or commercial use"（1200 dpi 版本）；300 dpi 宣传版不在许可内，没用 | ✅ | 见页面 | **必须署名** "Cartography by Dyson Logos"（直播间简介 / 画面里都行）。我们从原图裁出两层、去掉 Patreon 页脚、缩放，没有改图本身 |
| `resource_pack/Tokens PNG 300ppi/`（77 张怪物 / NPC token）→ `assets/tokens/lmop/*.png`，以及从里面复制成 `assets/tokens/{goblin,wolf,bugbear,skeleton,zombie,ghoul,giant_spider,cultist,bandit}.png` 的 9 张（原占位图留在 `assets/tokens/_replaced/`） | **来源没记**（用户 2026-10-19 放进来的"凡达林模组配套包"，没给 URL / 作者）。包里只有 `__Legal Stuff.docx`，原文：「All art in this folder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.」 | WotC Fan Content Policy（我只搜到摘要，文本日期 2017-11-15；摘要说：广告 / 赞助 / 打赏可以，不能设付费墙；收益直播算不算在内，WotC 自己的 FAQ 写得含糊）。**页面原文没读到，未核实** | ⚠️ 未核实 | ❌ | 人类 NPC 的头像类 token 角落有 "artflow.ai" 小水印（AI 生成图的网站）；怪物 token 没有。脚本 `trpg-table/scripts/import_lmop_tokens.py` |
| `resource_pack/Official Maps/`（5 张 jpg：劫掠巢穴 / 红标藏身处 / 索恩树废墟 / 劫掠堡 / 回响洞窟）、`resource_pack/1 Maps PDF 11x17 Printable/`（30 个 PDF） | 同一个包。Official Maps 里的 legal 文件多一行 "Cartographer: Mike Schley"——**这 5 张是 WotC 官方地图**（不是粉丝重绘），包作者把它们放在 Fan Content Policy 的说法之下；PDF 那 30 张包里没写作者 | 同上，未核实。**WotC 是否允许再分发官方地图我没法确认** | ⚠️ 未核实 | ❌ | **还没用在任何场景里**，只是放在 `resource_pack/`。第 4 节写过"WotC 官方模组：非开放许可，不用"，要用先由 用户 决定 |
| `sprites/`、`assets/tokens/faces/`、`characters/`（根目录那批）里的角色图 | 用户 用 ChatGPT 生成的原创角色（维斯坡伊、萨珀特菲） | ChatGPT 生成图的权利按 OpenAI 条款属于用户，**这里未核实** | ⚠️ 未核实 | — | 切表情表和裁头像是本项目的脚本，不改画面 |

## 2. SRD 署名（必须保留）

> This work includes material taken from the System Reference Document 5.1 ("SRD 5.1")
> by Wizards of the Coast LLC, available at
> https://dnd.wizards.com/resources/systems-reference-document.
> The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License,
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

本项目实现的是 **SRD 5.1（2014）** 的可核对子集；没有实现 2024（SRD 5.2.1）专有内容（武器精通等）。
SRD 5.1 与 5.2 都是 CC-BY-4.0。Open5e v2 的 `srd-2024` 文档也是 CC-BY-4.0（已核对文档元数据，
见 `trpg-table/docs/RULES_SPIKE.md` §3.1）。

## 3. 软件

| 软件 | 许可证 | 说明 |
| --- | --- | --- |
| Atlas VTT 0.8.0（Obsidian 插件） | 未在本 vault 内核对许可证文件；按官方 release 本地安装 | 不随本项目再发布 |
| atlas-agent-link | AGPL-3.0-only（见其 `LICENSE` / `docs/HANDOFF.md`） | 本地运行；trpg-table 没有复制它的代码，只按 `docs/INTEGRATION.md` 的协议自己实现客户端 |
| trpg-table | 本项目（未定许可证） | 本地使用；如果要开源/分发再决定 |
| 阿里云百炼 qwen3-tts-flash（配音：Eldric Sage / Kai / Marcus 三个系统音色） | 付费 API（北京地域约 0.8 元 / 万字符），按阿里云百炼服务条款 | 合成出来的音频能不能用在收益直播里、要不要标注 AI 配音：**我没读服务条款原文，未核实**；密钥在 `trpg-table/.env`（不进仓库） |

## 4. 候选素材（**下载前必须用户点头**）

许可证列只写我在网页上**亲眼读到**的；没读到的标「未核实」。

### 剧本 / one-shot 候选

| 候选 | 来源 | 许可证 | 商用直播 | 结论 |
| --- | --- | --- | --- | --- |
| 自编《银鸥号的残骸》（当前使用） | 本项目 | CC-BY-4.0 | ✅ | **已采用**，用户审稿即可 |
| One Page Dungeon Contest 作品（选一届） | https://www.dungeoncontest.com/ | 各届/各作者不同，常见 CC-BY-SA；**未逐篇核实** | 需逐篇核实 | 候选；下载前先确认那一篇的版权声明 |
| Winghorn Press / DMs Guild 免费 one-shot | DMs Guild | DMs Guild 社区内容协议；**未核实** | 一般允许直播，但**不能把 PDF/地图再发布** | 候选；需用户确认 |
| WotC 官方模组 | — | 非开放许可 | ❌ | 不用 |

### 地图候选

| 候选 | 来源 | 许可证 | 商用直播 | 结论 |
| --- | --- | --- | --- | --- |
| cornwielder "Crashed Ship"（日/夜） | https://www.drivethrurpg.com/en/product/587243/ | 页面被 Cloudflare 拦（HTTP 403），**未核实原文** | 任务书说「写的是商用和直播都可以，署名可选」，**未核实** | 候选；下载前用户确认 |
| berbmakes 免费地图包 | berbmakes | 任务书说「可以用在直播里，但不能再发布」，**未核实** | 可能 ✅ | 候选；不能进仓库/不能再发布 |
| 2-Minute Tabletop | https://2minutetabletop.com/faq/license-and-attribution/ | 页面抓到但正文被截断，**未核实** | 未核实 | 候选；需要用户去页面确认 |
| Dyson Logos 地图 | https://dysonlogos.blog/about/copyright/ | **已核实**：普通地图是**非商业**许可；只有标为 "Commercial Maps" 的才允许商用（需署名 "Cartography by Dyson Logos"） | 普通图 ❌；Commercial Maps ✅（需署名） | 不用普通图；要用只选 Commercial Maps |
| 本项目原创占位图 | 本项目 | CC-BY-4.0 | ✅ | 当前使用 |

### 关于 CC BY-NC

用户 2026-10-17 明确说：「可以接受 NC 素材，风险我自己担」。但**B 站直播有收益**，NC 的
"NonCommercial" 是否覆盖带打赏的直播有法律风险；本项目仍优先选可商用素材。若用户之后改主意，
把 NC 素材从 vault 移除即可。

## 5. 待用户决定

1. 正式地图用哪一套（原创占位 / cornwielder / berbmakes / Commercial Maps / 其他）。
2. 剧本用自编《银鸥号的残骸》，还是换 One Page Dungeon / DMs Guild 的 one-shot。
3. 角色卡与人设定稿（`characters/player_a.json`、`player_b.json`）。
4. 立绘（`sprites/`，规格见 `sprites/README.md`）。
