# 立绘规格（给用户 / 给 GPT）

> **2026-10-18 晚：当前立绘是半身特写，不是下面写的 1024×1536 全身。**
> `player_a` = 维斯坡伊（Triton 生命牧师，DeepSeek），`player_b` = 萨珀特菲（Tabaxi 野蛮人，Gemini）。
> 每人一张 4×2 表情表（`characters\sprits_deepseek.png` / `sprits_gemini.png`，顺序：
> neutral happy smug angry / scared surprised thinking hurt），用
> `python trpg-table/scripts/slice_sprite_sheets.py <表.png> <seat>` 切成 8 张（433×419 / 423×414，抠掉白底），
> 再 `python trpg-table/scripts/make_token_avatars.py` 裁棋子头像。`faces.json` 里的框已按特写重量过，
> 带 `autoCenterX`（按头重新居中）和 `allowOutside`（越过上沿补透明）。
> 被替换掉的占位图在 `sprites/_replaced/`、`assets/tokens/faces/_replaced/`。
> 白底的下沿是出图时自带的毛边（身体渐隐成白），头像不用那一块，没处理。
> 下面的"硬要求 / 提示词模板"是原来给全身立绘定的，现在只有 `faces.json` 那几条对头像有用。

> **V2（2026-10-18）：画面上不再显示立绘**（没有人物栏了）。立绘现在只有一个用处：
> 从里面裁出圆形脸部头像，当作 Atlas 棋子的图，见文末「棋子头像（V2）」。立绘文件和下面的规格照旧。

立绘放在 `campaign-vault/sprites/<seat>/`。`<seat>` 只能是 `player_a`、`player_b`。

## 文件

```
sprites/player_a/neutral.png
sprites/player_a/happy.png
sprites/player_a/smug.png
sprites/player_a/angry.png
sprites/player_a/scared.png
sprites/player_a/surprised.png
sprites/player_a/thinking.png
sprites/player_a/hurt.png
```

`player_b` 同样一套。表情 id（overlay 与玩家 JSON 共用）：
`neutral | happy | smug | angry | scared | surprised | thinking | hurt`。

**当前 `neutral.png` 是占位图**（768×1152，2:3，由
`trpg-table/scripts/make_placeholder_portrait.py` 生成的有头有身体的简笔立绘），
用来给 用户 挑布局，不是正式立绘。正式立绘按下面规格用 GPT 出，直接覆盖同名文件即可。

## 硬要求

- **透明背景 PNG**，不要白底、不要边框。
- 同一个角色的 8 张**画布尺寸完全一样**，建议 **1024×1536**（竖版）。
- 角色尽量站在画布底部，头顶留一点空间；overlay 按 `object-fit: contain` 缩放。
- 缺哪张就用 `neutral.png`；连 `neutral.png` 都没有，overlay 画一个占位剪影加名字。
- Atlas 的 token 头像可以从 `neutral.png` 裁一个圆形（脚本后续补；现在 token 用 `assets/tokens/` 的占位图）。

## 给 GPT 的出图提示词模板

> 目标：同一个角色、同一套画风、同一画布，只换表情，保证 8 张图看起来是一个人。

先定一张基准图（neutral），之后每张都把基准图作为**参考图**一起发给模型，并用同一段角色描述：

```
【角色设定】<名字>，<种族/职业>，<年龄/体型>，<发型/发色>，<瞳色>，<服装与装备>，<标志性细节>。
【画风】日系奇幻半写实，干净线稿，柔和赛璐璐上色；深蓝/蓝青环境光，金色只用于高光；不要大面积高饱和暖色。
【构图】竖版 1024×1536，透明背景，全身/七分身，站在画面底部，正面偏 3/4，双手自然下垂或轻握武器。
【本张表情】<neutral：平静，嘴角平；happy：真心笑；smug：得意、挑眉；angry：压着怒火；scared：瞳孔缩小、后仰；surprised：睁大眼、张嘴；thinking：眼神飘向一侧、手指抵下巴；hurt：皱眉、按着伤口>。
【一致性要求】与参考图保持完全相同的人脸、发型、服装、配色、画风和画布；只改变表情和轻微肢体语言；不要加文字、边框、背景。
```

生成后用同一张画布裁切/对齐；文件名按上面的表情 id 保存。

## 棋子头像（V2）

人物栏没了，表情体现在**棋子头像**上：

- `campaign-vault/sprites/faces.json` 里每个角色一个归一化脸部框 `{x,y,w,h}`（0–1，
  相对于 2:3 画布）。立绘只要求**脸部位置一致**，脚本就能自动裁出头像。
- 生成：`python trpg-table/scripts/make_token_avatars.py`。它把每个已有的表情图裁成
  256×256，输出 `campaign-vault/assets/tokens/faces/<seat>-<expression>.png`。
- Atlas 棋子用 `faces/<seat>-neutral.png`；换表情时 `trpg-table` 用
  `atlas_update_token` 切到对应表情的头像（`overlay.yaml` 的 `token_expressions: true`）。
- 没有头像文件时保留 `assets/tokens/<seat>.png` 的旧头像。
- 当前 `faces.json` 的框是按占位立绘量的大致值；正式立绘出来后按脸部实际位置微调一次即可。

## 尺寸检查

```powershell
Add-Type -AssemblyName System.Drawing
Get-ChildItem campaign-vault\sprites\player_a\*.png | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  "{0}: {1}x{2}" -f $_.Name, $img.Width, $img.Height
  $img.Dispose()
}
```
