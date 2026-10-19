# 法术数据的来源与署名

`spells.ts`（手写的核心法术）和 `spellsSrd.ts`（SRD 5.1 法术全表）里的法术数据取自
**System Reference Document 5.1（SRD 5.1，2014）**。

> This work includes material taken from the System Reference Document 5.1 ("SRD 5.1")
> by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document.
> The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License,
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

© Wizards of the Coast LLC，CC-BY-4.0。项目范围内的署名汇总见 `../NOTICE.md` 与 `docs/RULES_SPIKE.md` §3.1。

## 收录范围

- `spellsSrd.ts`：SRD 5.1 的 319 个法术里除去 `spells.ts` 已手写的 26 个之外的 **293 个**
  （戏法 17、1 环 39、2 环 45、3 环 42、4 环 31、5 环 37、6 环 31、7 环 20、8 环 16、9 环 15）。
  职业法术表按 SRD / 玩家手册的基础职业列表填写，**不含子职业追加的法术**（域法术、誓言法术、领域法术等）。
- `spells.ts` 里手写的 27 个法术中，**亡者丧钟（toll_the_dead）不在 SRD 5.1 里**（它来自《Xanathar 的万事指南》），
  是项目早期手写的，保留不动。

## 怎么写的

- 名称、环阶、学派、施法时间、射程、成分、时长、专注、仪式、职业列表等机械字段，以 SRD 5.1 为准，
  录入时对照过 Open5e 的 SRD 5.1 数据（<https://api.open5e.com/v1/spells/?document__slug=wotc-srd>，CC-BY SRD 数据；
  只在本地临时目录里下载核对，没有放进项目），所有伤害 / 治疗 / 升环骰子公式逐个核对过原文。
- 规则效果是用**中文压缩改写**的一行说明（`effect.note` / `note`），不是 SRD 原文照抄；
  记不清或原文里有表格的地方（如传送术的熟悉度概率表）写「见 SRD」，没有自己编数值。
- 引擎认的时长只有 立即 / 1 轮 / 1 分钟 / 10 分钟 / 1 小时；更长的（8 小时、24 小时、直到解除……）记成 `1 小时`，
  真实时长写在说明里。施法时间 ≥ 1 分钟的法术记成 `action`，说明里写明真实施法时间。

## 与 SRD 字段不完全一致的地方（为了让引擎按近战 / 射程正确结算）

| 法术 | SRD 写的 | 数据里写的 | 原因 |
| --- | --- | --- | --- |
| 生火术 `produce_flame` | 射程自身 | 30 尺 | 火焰掷出去是 30 尺内的远程法术攻击，让引擎检查距离 |
| 吸血之触 `vampiric_touch` | 射程自身 | 触碰 | 攻击是触及范围内的近战法术攻击，让引擎按近战结算 |
| 魔能爆 `eldritch_blast` | — | `attacks: 1` | 5/11/17 级的射线数 2/3/4 由引擎按施法者等级算（`cantripScaling`） |
| 传送术 `teleport`、复活类等 | — | utility | 引擎没有对应机制，说明里写清效果，GM 裁定 |
