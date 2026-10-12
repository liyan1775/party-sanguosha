# 官方活动将池核对

核对日期：2026-10-12。固定无名杀 v1.11.6，commit `2367607e246d21aae168dba15c01151ee0651f30`。

按官方完整公告的名单导入已有原生角色，保留活动、平台、届次和年份。游戏平台版本必须对应：OL谋关羽使用 `ol_sb_guanyu`，不用手杀 `sb_guanyu` 或新杀 `dc_sb_guanyu`。别名、界字和原生ID前缀不能代替技能核对。无法对应的角色保留在公告清单中，但从可选白名单排除；不替换、不删技能、不自行实现角色，也不为此升级引擎。用户2026-10-12确认按非主公技能核对，名称可以不同，允许原生多出主公技；保留完整原生技能及主公标记。例如张绣保留踞襄，OL界孙坚保留破虏，OL界黄忠对应原生黄忠 `re_huangzhong`。大厅与图鉴显示具体版本提示。关联技能也参与核对，非主公机制不同仍列为缺项。

只导入将池。本项目仍采用现有身份、斗地主、OL常规2v2和单武将单挑规则，新增档位使用军争160张（去木牛流马），不复刻赛事BP、报名、计分、换将道具或赛事专用牌堆。图鉴技能取固定引擎同版本文本，不能将本表理解为商业客户端所有历次技能修订的复刻。

| 官方将池                                                                            | 公告日期   | 已导入 / 公告 | 缺项                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ---------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OL全民斗地主S15（2026）](https://www.sanguosha.com/news/20260929_7838_3119)        | 2026-09-30 | 92/92         | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [移动版高校先锋赛（2026首届）](https://www.sanguosha.cn/pc/news-detail-2318.html)   | 2026-05-27 | 63/66         | 势王昶、友徐庶、骥张辽                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [移动版群雄逐鹿2v2（2026年9月）](https://www.sanguosha.cn/pc/news-detail-2374.html) | 2026-09-03 | 83/88         | 势陈到、乐就、阳球、骥李典、骥张辽                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [一将成名全民赛S19（2026）](https://x.sanguosha.com/news/20260908_5740_2710.html)   | 2026-09-08 | 90/90         | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [移动版群雄逐鹿第十二届（2024）](https://www.sanguosha.cn/pc/news-detail-1947.html) | 2024-11-06 | 120/120       | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [移动版群雄逐鹿第十六届（2025）](https://www.sanguosha.cn/pc/news-detail-2059.html) | 2025-04-28 | 119/120       | 友徐庶                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [OL排位基础池（2026年10月）](https://www.sanguosha.com/news/20260922_1251_1414)     | 2026-09-30 | 147/151       | 界沮授、谋周瑜、唐棠、谢灵毓                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [OL排位完整池（2026年10月）](https://www.sanguosha.com/news/20260922_1251_1414)     | 2026-09-30 | 284/288       | 界沮授、谋周瑜、唐棠、谢灵毓                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [OL SGL第一赛段（2026）](https://www.sanguosha.com/news/20260608_6402_4317)         | 2026-06-08 | 83/83         | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [手杀斗地主·时光场（公开目录）](https://www.sanguosha.cn/)                          | 2026-10-11 | 258/326       | 典韦、孟获、姜维、孙策、许攸、卢植、周妃、陆抗、界马超、界吕蒙、界孙策、高顺、马谡、于禁、曹彰、步练师、刘表、郭淮、周仓、顾雍、界凌统、辛宪英、伏完、杨修、SP马超、SP赵云、SP貂蝉、SP贾诩、陈琳、大乔小乔、诸葛恪、张宝、乐进、诸葛瑾、诸葛诞、何太后、孙皓、蹋顿、严白虎、SP黄月英、步骘、赵襄、马忠、麹义、吕虔、马云騄、张梁、刘琦、郭汜、徐荣、王元姬、樊稠、严畯、吕岱、周鲂、刘繇、曹婴、张琪瑛、许贡、吕凯、杨仪、司马徽、神周瑜、神刘备、神张辽、凌操、郑玄、星甘宁 |

持久依据为 [official-rosters.json](../config/official-rosters.json)，运行白名单为 [roster-presets.json](../config/roster-presets.json)。运行 `npm run engine:update-official-rosters` 可从已审查映射重建白名单、跨端说明和本文；原始下载页和图片仅在忽略的.local中保留过程副本，官方链接可重新获取。该生成器不会凭同名自动匹配武将。

## OL全民斗地主S15（2026）

[官方公告](https://www.sanguosha.com/news/20260929_7838_3119)；发布于 2026-09-30。对应原活动斗地主，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID             | 定义包   | 原生技能 / 缺项原因       |
| -------------- | ------------------ | -------- | ------------------------- |
| 许攸           | `xuyou`            | shenhua  | 成略 / 恃才 / 寸目        |
| 郝昭           | `haozhao`          | shenhua  | 镇骨                      |
| 诸葛瞻         | `zhugezhan`        | shenhua  | 罪论 / 父荫               |
| 张绣           | `zhangxiu`         | shenhua  | 雄乱 / 从谏 / 踞襄        |
| 马谡           | `xin_masu`         | yijiang  | 散谣 / 制蛮               |
| 吴懿           | `wuyi`             | yijiang  | 奔袭                      |
| 沮授           | `yj_jushou`        | yijiang  | 渐营 / 矢北               |
| 朱治           | `zhuzhi`           | yijiang  | 安国                      |
| 嵇康           | `jikang`           | yijiang  | 清弦 / 绝响               |
| 秦宓           | `qinmi`            | yijiang  | 谏征 / 专对 / 天辩        |
| 界黄忠         | `re_huangzhong`    | shenhua  | 烈弓                      |
| 界关羽         | `re_guanyu`        | refresh  | 武圣 / 义绝               |
| 界张飞         | `re_zhangfei`      | refresh  | 咆哮 / 替身               |
| 界赵云         | `re_zhaoyun`       | refresh  | 龙胆 / 涯角               |
| 界马超         | `re_machao`        | refresh  | 马术 / 铁骑               |
| 界吕蒙         | `re_lvmeng`        | refresh  | 克己 / 勤学 / 博图        |
| 界黄盖         | `re_huanggai`      | refresh  | 苦肉 / 诈降               |
| 界陆逊         | `re_luxun`         | refresh  | 谦逊 / 连营               |
| 界许褚         | `re_xuzhu`         | refresh  | 裸衣                      |
| 界郭嘉         | `re_guojia`        | refresh  | 天妒 / 遗计               |
| 界吕布         | `re_lvbu`          | refresh  | 无双 / 利驭               |
| 界诸葛亮       | `re_zhugeliang`    | refresh  | 观星 / 空城               |
| 界黄月英       | `re_huangyueying`  | refresh  | 集智 / 奇才               |
| 界孙权         | `re_sunquan`       | refresh  | 制衡 / 救援               |
| 界甄姬         | `re_zhenji`        | refresh  | 洛神 / 倾国               |
| 界张角         | `re_zhangjiao`     | refresh  | 雷击 / 鬼道 / 黄天        |
| 界刘禅         | `ol_liushan`       | refresh  | 享乐 / 放权 / 若愚        |
| 界孙策         | `re_sunce`         | refresh  | 激昂 / 魂姿 / 制霸        |
| 界魏延         | `ol_weiyan`        | refresh  | 狂骨 / 奇谋               |
| 界姜维         | `ol_jiangwei`      | refresh  | 挑衅 / 志继               |
| 界贾诩         | `re_jiaxu`         | refresh  | 完杀 / 乱武 / 帷幕        |
| 界荀彧         | `ol_xunyu`         | refresh  | 驱虎 / 节命               |
| 界徐盛         | `re_xusheng`       | mobile   | 破军                      |
| 界王异         | `ol_wangyi`        | onlyOL   | 贞烈 / 秘计               |
| 界张春华       | `ol_zhangchunhua`  | onlyOL   | 绝情 / 伤逝 / 翦灭        |
| 界曹冲         | `ol_caochong`      | onlyOL   | 称象 / 仁心               |
| 界李儒         | `ol_liru`          | onlyOL   | 绝策 / 灭计 / 焚城        |
| 神吕蒙         | `shen_lvmeng`      | extra    | 涉猎 / 攻心               |
| 神周瑜         | `shen_zhouyu`      | extra    | 业炎 / 琴音               |
| 神吕布         | `shen_lvbu`        | extra    | 狂暴 / 无谋 / 无前 / 神愤 |
| 神司马懿       | `shen_simayi`      | extra    | 忍戒 / 拜印 / 连破        |
| 神刘备         | `shen_liubei`      | extra    | 龙怒 / 结营               |
| 神陆逊         | `shen_luxun`       | extra    | 军略 / 摧克 / 绽火        |
| 神甘宁         | `shen_ganning`     | extra    | 魄袭 / 劫营               |
| 神张角         | `junk_zhangjiao`   | onlyOL   | 异兆 / 肆军 / 天劫        |
| 神典韦         | `shen_dianwei`     | onlyOL   | 捐甲 / 挈挟 / 摧决        |
| 谋姜维         | `ol_sb_jiangwei`   | onlyOL   | 逐日 / 燃己               |
| 谋关羽         | `ol_sb_guanyu`     | onlyOL   | 威临 / 夺首               |
| 谋董卓         | `ol_sb_dongzhuo`   | onlyOL   | 观变 / 凶逆 / 封赏 / 执柄 |
| 谋孙坚         | `ol_sb_sunjian`    | onlyOL   | 虎烈 / 毅魄               |
| 谋庞统         | `ol_sb_pangtong`   | onlyOL   | 鸿图 / 栖梧               |
| 谋公孙瓒       | `ol_sb_gongsunzan` | onlyOL   | 剿狄 / 保京               |
| 谋文丑         | `ol_sb_wenchou`    | onlyOL   | 轮战 / 决绝               |
| 谋张绣         | `ol_sb_zhangxiu`   | onlyOL   | 仇猎 / 追剿               |
| 谋卢植         | `ol_sb_yl_luzhi`   | onlyOL   | 司兵 / 敛策               |
| 谋诸葛亮       | `ol_sb_zhugeliang` | onlyOL   | 知天 / 武靖 / 智绝        |
| 谋许攸         | `ol_sb_xuyou`      | onlyOL   | 迁附 / 驭势 / 焚巢        |
| 魔曹操         | `dm_caocao`        | onlyOL   | 霸朝 / 覆载               |
| 魔吕布         | `dm_lvbu`          | onlyOL   | 夺炁 / 狂魔 / 罡拳        |
| 族钟琰         | `clan_zhongyan`    | clan     | 观骨 / 啸咏 / 保族        |
| 族钟会         | `clan_zhonghui`    | clan     | 迂志 / 挟术 / 保族        |
| 族荀攸         | `clan_xunyou`      | clan     | 百出 / 蹈节               |
| 族杨赐         | `clan_yangci`      | clan     | 切议 / 谏直 / 去惑        |
| 族杨彪         | `clan_yangbiao`    | clan     | 间难 / 义叱 / 去惑        |
| SP马超         | `sp_machao`        | sp       | 追击 / 誓仇               |
| SP赵云         | `sp_zhaoyun`       | sp       | 龙胆 / 冲阵               |
| SP貂蝉         | `sp_diaochan`      | sp       | 离魂 / 闭月               |
| SP张郃         | `sp_ol_zhanghe`    | sp       | 周旋                      |
| SP黄月英       | `jsp_huangyueying` | sp       | 机巧 / 玲珑               |
| SP孙策         | `sp_sunce`         | sp       | 连讨                      |
| 祢衡           | `ol_miheng`        | sp       | 狂狷 / 飞辩               |
| 曹昂           | `caoang`           | sp       | 慷忾                      |
| 马良           | `ol_maliang`       | diy      | 自书 / 应援               |
| 王荣           | `ol_wangrong`      | sp       | 丰姿 / 吉占 / 赋颂        |
| 糜竺           | `mizhu`            | sp       | 资援 / 巨贾               |
| 麹义           | `quyi`             | sp       | 伏骑 / 骄恣               |
| 戏志才         | `xizhicai`         | sp       | 天妒 / 先辅 / 筹策        |
| 李傕           | `lijue`            | sp2      | 狼袭 / 亦算               |
| 沙摩柯         | `shamoke`          | sp       | 蒺藜                      |
| 丁原           | `ol_dingyuan`      | sp2      | 慈孝 / 先率               |
| 杨仪           | `ol_yangyi`        | sp       | 狷狭 / 定措               |
| 羊祜           | `jin_yanghu`       | sp       | 怀远 / 崇信 / 德彰        |
| 吕伯奢         | `lvboshe`          | sp       | 缚豕 / 东道               |
| 刘焉           | `liuyan`           | sp       | 图射 / 立牧               |
| 鲍三娘         | `baosanniang`      | sp       | 武娘 / 镇南 / 许身        |
| 曹婴           | `caoying`          | sp       | 凌人 / 伏间               |
| 徐荣           | `xurong`           | xianding | 凶镬 / 杀绝               |
| 曹纯           | `caochun`          | sp       | 缮甲                      |
| 周处           | `jin_zhouchu`      | sp       | 善断 / 义烈               |
| 费祎           | `ol_feiyi`         | sp       | 晏如 / 和衷               |
| 蒋琬           | `ol_jiangwan`      | sp       | 自若 / 蓄发               |
| 薛灵芸         | `ol_xuelingyun`    | sp       | 思泣 / 巧织               |

- 张绣 → `zhangxiu`：雄乱／从谏与该平台版本相同；保留完整原生额外主公技踞襄及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.com/hero/415)
- 界黄忠 → `re_huangzhong`：OL界黄忠的烈弓对应原生黄忠（re_huangzhong）；原生OL黄忠（ol_huangzhong）另有非主公技没矢，不采用该候选。 [版本依据](https://www.sanguosha.com/hero/26)
- 界徐盛 → `re_xusheng`：复核OL官方页的完整破军文本，含手牌数和装备数均不多于本人时伤害+1；固定原生repojun/repojun2/repojun3与此规则对应。原生显示名虽为手杀界徐盛，其规则与当前OL版相同，不采用带额外弃装备／摸牌的xin_xusheng。 [版本依据](https://www.sanguosha.com/hero/587)
- 马良 → `ol_maliang`：OL应援从牌堆获得同类型牌；移动版 maliang 交出用过的牌，必须分别选择。 [版本依据](https://www.sanguosha.com/hero/128)
- 羊祜 → `jin_yanghu`：OL羊祜是晋势力怀远/崇信/德彰，不是新杀德劭/明伐或移动版明伐/戎备。 [版本依据](https://www.sanguosha.com/hero/497)
- 刘焉 → `liuyan`：按用户2026-10-10确认及OL官方武将页采用图射／立牧；junk_liuyan为偏安／殷积／窥伺的旧版本，不作为本档刘焉。 [版本依据](https://www.sanguosha.com/hero/634)

## 移动版高校先锋赛（2026首届）

[官方公告](https://www.sanguosha.cn/pc/news-detail-2318.html) · [公告将池原图](https://www.sanguosha.cn/storage/uploads/images/3YWoQJT40GjnVOBwB71kb1VnBqX0gIvnLDnJJakj.png)；发布于 2026-05-27。对应原活动斗地主，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID            | 定义包   | 原生技能 / 缺项原因                                                                        |
| -------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------ |
| 界关羽         | `re_guanyu`       | refresh  | 武圣 / 义绝                                                                                |
| 界黄盖         | `re_huanggai`     | refresh  | 苦肉 / 诈降                                                                                |
| 界孙权         | `re_sunquan`      | refresh  | 制衡 / 救援                                                                                |
| 界吕布         | `re_lvbu`         | refresh  | 无双 / 利驭                                                                                |
| 诸葛瞻         | `zhugezhan`       | shenhua  | 罪论 / 父荫                                                                                |
| 许攸           | `junk_xuyou`      | diy      | 成略 / 恃才 / 寸目                                                                         |
| 界徐盛         | `re_xusheng`      | mobile   | 破军                                                                                       |
| 界于禁         | `ol_yujin`        | mobile   | 节钺                                                                                       |
| 界王异         | `re_wangyi`       | refresh  | 贞烈 / 秘计                                                                                |
| 界全琮         | `xin_quancong`    | mobile   | 邀名                                                                                       |
| 界李儒         | `re_liru`         | mobile   | 绝策 / 灭计 / 焚城                                                                         |
| 张春华         | `zhangchunhua`    | yijiang  | 绝情 / 伤逝                                                                                |
| 秦宓           | `qinmi`           | yijiang  | 谏征 / 专对 / 天辩                                                                         |
| 界沮授         | `xin_jushou`      | mobile   | 渐营 / 矢北                                                                                |
| 势太史慈       | `pot_taishici`    | bingshi  | 酣战 / 战烈 / 振锋                                                                         |
| 势桓阶         | `pot_huanjie`     | bingshi  | 共谋 / 正朔                                                                                |
| 势辛宪英       | `pot_xinxianying` | bingshi  | 诫节 / 清识                                                                                |
| 势魏延         | `pot_weiyan`      | bingshi  | 忠傲 / 壮誓 / 饮战                                                                         |
| 势董昭         | `pot_dongzhao`    | bingshi  | 妙略 / 迎驾                                                                                |
| 势王昶         | **缺项**          | —        | 固定核心没有移动版势王昶；TW 王昶的开济、设叛结算不同。                                    |
| 谋貂蝉         | `sb_diaochan`     | sb       | 离间 / 闭月                                                                                |
| 谋马超         | `sb_machao`       | sb       | 马术 / 铁骑                                                                                |
| 谋黄忠         | `sb_huangzhong`   | sb       | 烈弓                                                                                       |
| 谋吕布         | `sb_lvbu`         | sb       | 无双 / 利驭                                                                                |
| 谋公孙瓒       | `sb_gongsunzan`   | sb       | 义从 / 趫猛                                                                                |
| 谋曹操         | `sb_caocao`       | sb       | 奸雄 / 清正 / 护驾                                                                         |
| 骆统           | `luotong`         | shiji    | 勤政                                                                                       |
| 蒋钦           | `sp_jiangqing`    | shiji    | 俭衣 / 尚义                                                                                |
| 周处           | `zhouchu`         | shiji    | 乡害 / 除害                                                                                |
| 高览           | `sp_gaolan`       | shiji    | 峻攻 / 等力                                                                                |
| 文鸯           | `db_wenyang`      | shiji    | 却敌 / 椎锋 / 冲坚 / 仇决                                                                  |
| 杜预           | `sp_duyu`         | shiji    | 武库 / 三陈                                                                                |
| 徐荣           | `xurong`          | xianding | 凶镬 / 杀绝                                                                                |
| 曹婴           | `caoying`         | sp       | 凌人 / 伏间                                                                                |
| 沙摩柯         | `shamoke`         | sp       | 蒺藜                                                                                       |
| 麴义           | `quyi`            | sp       | 伏骑 / 骄恣                                                                                |
| 裴秀           | `peixiu`          | mobile   | 行图 / 爵制                                                                                |
| 李傕           | `lijue`           | sp2      | 狼袭 / 亦算                                                                                |
| 马良           | `maliang`         | sp       | 自书 / 应援                                                                                |
| 刘焉           | `liuyan`          | sp       | 图射 / 立牧                                                                                |
| SP貂蝉         | `sp_diaochan`     | sp       | 离魂 / 闭月                                                                                |
| 王元姬         | `wangyuanji`      | mobile   | 谦冲 / 尚俭                                                                                |
| SP赵云         | `sp_zhaoyun`      | sp       | 龙胆 / 冲阵                                                                                |
| 张琪瑛         | `zhangqiying`     | sp       | 法箓 / 点化 / 真仪                                                                         |
| 毛玠           | `sp_maojie`       | mobile   | 秉清 / 迎奉                                                                                |
| 李遗           | `liwei`           | mobile   | 教化                                                                                       |
| 关银屏         | `mb_guanyinping`  | mobile   | 雪恨 / 虎啸 / 武继                                                                         |
| 孙鲁育         | `mb_sunluyu`      | mobile   | 魅步 / 穆穆                                                                                |
| 陈琳           | `chenlin`         | sp       | 笔伐 / 颂词                                                                                |
| 诸葛果         | `mb_zhugeguo`     | mobile   | 祈禳 / 羽化                                                                                |
| 神甘宁         | `shen_ganning`    | extra    | 魄袭 / 劫营                                                                                |
| 神孙策         | `shen_sunce`      | shiji    | 英霸 / 覆海 / 冯河                                                                         |
| 神赵云         | `shen_zhaoyun`    | extra    | 绝境 / 龙魂                                                                                |
| 神郭嘉         | `shen_guojia`     | shiji    | 慧识 / 天翊 / 辉逝                                                                         |
| 神马超         | `mb_shen_machao`  | shiji    | 驭雳 / 霆威 / 寂灭                                                                         |
| 神太史慈       | `shen_taishici`   | shiji    | 笃烈 / 破围                                                                                |
| 留赞           | `liuzan`          | mobile   | 奋音                                                                                       |
| 曹纯           | `mb_caochun`      | mobile   | 缮甲                                                                                       |
| 祢衡           | `miheng`          | mobile   | 狂才 / 舌剑                                                                                |
| 孙寒华         | `sunhanhua`       | mobile   | 冲虚 / 妙剑 / 莲华                                                                         |
| 友徐庶         | **缺项**          | —        | 固定核心的启诲明确标为海外版本，增加了援助其他角色与标记上限成长；移动版原生版本已被覆盖。 |
| 骥张辽         | **缺项**          | —        | 固定核心的荡势明确标为海外版本，加入第三选项与摸牌/加出杀次数；不采用此版本。              |
| 曹髦           | `mb_caomao`       | mobile   | 潜龙 / 卫统                                                                                |
| 司马昭         | `simazhao`        | mobile   | 怠攻 / 昭心                                                                                |
| 星甘宁         | `yj_ganning`      | newjiang | 锦帆 / 射却                                                                                |
| 星徐晃         | `yj_xuhuang`      | newjiang | 治严                                                                                       |

- 许攸 → `junk_xuyou`：原生内置diy包收纳手杀许攸的成略/恃才/寸目；不是自创角色或技能。
- 界于禁 → `ol_yujin`：ID虽有ol前缀，但原生目录明确为mobile手杀界于禁，技能节钺；不是OL界于禁镇军/毅重。
- 势王昶：[平台技能依据](https://www.sanguosha.cn/pc/hero-detail-641.html)；排除 `tw_wangchang`。
- 友徐庶：[平台技能依据](https://www.sanguosha.cn/pc/hero-detail-606.html)；排除 `friend_xushu`。
- 骥张辽：[平台技能依据](https://www.sanguosha.cn/hero-detail-647.html)；排除 `hefei_zhangliao`。

## 移动版群雄逐鹿2v2（2026年9月）

[官方公告](https://www.sanguosha.cn/pc/news-detail-2374.html) · [公告将池原图](https://www.sanguosha.cn/storage/uploads/images/t76kfO20opP9ESOWK3l3tPr4ZDXLkSgIUrspBczT.png)；发布于 2026-09-03。对应原活动2v2，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID             | 定义包   | 原生技能 / 缺项原因                                                                          |
| -------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------- |
| 界刘备         | `re_liubei`        | refresh  | 仁德 / 激将                                                                                  |
| 界关羽         | `re_guanyu`        | refresh  | 武圣 / 义绝                                                                                  |
| 界黄盖         | `re_huanggai`      | refresh  | 苦肉 / 诈降                                                                                  |
| 界许褚         | `re_xuzhu`         | refresh  | 裸衣                                                                                         |
| 界甄姬         | `re_zhenji`        | refresh  | 洛神 / 倾国                                                                                  |
| 界孙权         | `re_sunquan`       | refresh  | 制衡 / 救援                                                                                  |
| 界孙尚香       | `re_sunshangxiang` | refresh  | 枭姬 / 结姻                                                                                  |
| 界伊籍         | `xf_yiji`          | standard | 机捷 / 急援                                                                                  |
| 界黄忠         | `re_huangzhong`    | shenhua  | 烈弓                                                                                         |
| 界魏延         | `ol_weiyan`        | refresh  | 狂骨 / 奇谋                                                                                  |
| 界张角         | `re_zhangjiao`     | refresh  | 雷击 / 鬼道 / 黄天                                                                           |
| 界荀彧         | `re_xunyu`         | mobile   | 驱虎 / 节命                                                                                  |
| 界刘禅         | `re_liushan`       | mobile   | 享乐 / 放权 / 若愚                                                                           |
| 界王基         | `re_wangji`        | mobile   | 奇制 / 进趋                                                                                  |
| 界于禁         | `ol_yujin`         | mobile   | 节钺                                                                                         |
| 界法正         | `re_fazheng`       | refresh  | 恩怨 / 眩惑                                                                                  |
| 界步练师       | `re_bulianshi`     | mobile   | 安恤 / 追忆                                                                                  |
| 界廖化         | `xin_liaohua`      | mobile   | 当先 / 伏枥                                                                                  |
| 界朱然         | `xin_zhuran`       | mobile   | 胆守                                                                                         |
| 界满宠         | `re_manchong`      | refresh  | 峻刑 / 御策                                                                                  |
| 界李儒         | `re_liru`          | mobile   | 绝策 / 灭计 / 焚城                                                                           |
| 界曹真         | `xin_caozhen`      | mobile   | 司敌                                                                                         |
| 界吴懿         | `xin_wuyi`         | mobile   | 奔袭                                                                                         |
| 界朱桓         | `xin_zhuhuan`      | mobile   | 奋励 / 平寇                                                                                  |
| 界全琮         | `xin_quancong`     | mobile   | 邀名                                                                                         |
| 荀攸           | `xunyou`           | yijiang  | 奇策 / 智愚                                                                                  |
| 张松           | `zhangsong`        | yijiang  | 强识 / 献图                                                                                  |
| 钟繇           | `mb_zhongyao`      | mobile   | 活墨 / 佐定                                                                                  |
| 秦宓           | `qinmi`            | yijiang  | 谏征 / 专对 / 天辩                                                                           |
| 谋周瑜         | `sb_zhouyu`        | sb       | 英姿 / 反间                                                                                  |
| 谋马超         | `sb_machao`        | sb       | 马术 / 铁骑                                                                                  |
| 谋韩当         | `sb_handang`       | sb       | 弓骑 / 解烦                                                                                  |
| 谋郭嘉         | `sb_guojia`        | sb       | 天妒 / 遗计                                                                                  |
| 谋张郃         | `sb_zhanghe`       | sb       | 巧变 / 料势                                                                                  |
| 谋刘赪         | `liucheng`         | sb       | 掠影 / 莺舞                                                                                  |
| 谋夏侯渊       | `sb_xiahouyuan`    | sb       | 神速 / 整辎                                                                                  |
| 谋卢植         | `sb_yl_luzhi`      | sb       | 明任 / 卫旒                                                                                  |
| 谋黄月英       | `sb_huangyueying`  | sb       | 集智 / 奇才                                                                                  |
| 谋高顺         | `sb_gaoshun`       | sb       | 陷阵 / 禁酒                                                                                  |
| 谋华雄         | `sb_huaxiong`      | sb       | 耀武 / 扬威                                                                                  |
| 谋公孙瓒       | `sb_gongsunzan`    | sb       | 义从 / 趫猛                                                                                  |
| 谋诸葛瑾       | `sb_zhugejin`      | sb       | 缓释 / 弘援 / 明哲                                                                           |
| 谋吕蒙         | `sb_lvmeng`        | sb       | 克己 / 渡江                                                                                  |
| 谋祝融         | `sb_zhurong`       | sb       | 烈刃 / 巨象                                                                                  |
| 陈震           | `sp_chenzhen`      | shiji    | 歃盟                                                                                         |
| 吴景           | `wujing`           | shiji    | 合击 / 流兵                                                                                  |
| 周处           | `zhouchu`          | shiji    | 乡害 / 除害                                                                                  |
| 羊祜           | `sp_yanghu`        | shiji    | 明伐 / 戎备                                                                                  |
| 高览           | `sp_gaolan`        | shiji    | 峻攻 / 等力                                                                                  |
| 袁涣           | `yuanhuan`         | shiji    | 请决 / 奉节                                                                                  |
| 蒋钦           | `sp_jiangqing`     | shiji    | 俭衣 / 尚义                                                                                  |
| 蒋琬           | `sp_jiangwan`      | shiji    | 镇庭 / 尽瘁                                                                                  |
| 朱儁           | `sp_zhujun`        | shiji    | 佯解 / 拒降 / 厚俸                                                                           |
| 势孙綝         | `pot_sunchen`      | bingshi  | 逆固 / 戮连                                                                                  |
| 势夏侯尚       | `mb_xiahoushang`   | bingshi  | 探锋                                                                                         |
| 势陈到         | **缺项**           | —        | 固定核心的弘毅明确标为海外版本，初始3枚、上限5枚且按每点伤害增加；移动版为初始2枚、上限4枚。 |
| 势程普         | `pot_chengpu`      | bingshi  | 督佐 / 蔽扞                                                                                  |
| 势鲁肃         | `pot_lusu`         | bingshi  | 好施 / 缔盟                                                                                  |
| 势桓阶         | `pot_huanjie`      | bingshi  | 共谋 / 正朔                                                                                  |
| 诸葛恪         | `zhugeke`          | sp       | 傲才 / 黩武                                                                                  |
| 关银屏         | `mb_guanyinping`   | mobile   | 雪恨 / 虎啸 / 武继                                                                           |
| SP赵云         | `sp_zhaoyun`       | sp       | 龙胆 / 冲阵                                                                                  |
| 刘协           | `liuxie`           | sp       | 天命 / 密诏 / 坠廷                                                                           |
| 程昱           | `mb_chengyu`       | mobile   | 设伏 / 贲育                                                                                  |
| 董白           | `mb_dongbai`       | mobile   | 连诛 / 黠慧                                                                                  |
| 麴义           | `quyi`             | sp       | 伏骑 / 骄恣                                                                                  |
| 沙摩柯         | `shamoke`          | sp       | 蒺藜                                                                                         |
| 曹婴           | `caoying`          | sp       | 凌人 / 伏间                                                                                  |
| 张翼           | `zhangyì`          | mobile   | 执义                                                                                         |
| 李丰           | `lifeng`           | mobile   | 屯储 / 输粮                                                                                  |
| 裴秀           | `peixiu`           | mobile   | 行图 / 爵制                                                                                  |
| 李遗           | `liwei`            | mobile   | 教化                                                                                         |
| 鲍信           | `baoxin`           | mobile   | 募讨 / 毅谋                                                                                  |
| 杨奉           | `yangfeng`         | mobile   | 血途 / 威命                                                                                  |
| 霍峻           | `xin_huojun`       | mobile   | 伺怠 / 竭御                                                                                  |
| 吴珂           | `wuke`             | mobile   | 谙达 / 助国                                                                                  |
| 乐就           | **缺项**           | —        | 固定核心只标注 TW 与新杀乐就，没有移动版原生角色；新杀催进还可触发决斗且摸两张，不能替代。   |
| 阳球           | **缺项**           | —        | 固定核心没有移动版阳球；jsrg_yangqiu 是江山如故版本，技能不同。                              |
| 崔琰毛玠       | `mb_cuimao`        | mobile   | 征辟 / 奉迎                                                                                  |
| 神吕蒙         | `shen_lvmeng`      | extra    | 涉猎 / 攻心                                                                                  |
| 神陆逊         | `shen_luxun`       | extra    | 军略 / 摧克 / 绽火                                                                           |
| 神太史慈       | `shen_taishici`    | shiji    | 笃烈 / 破围                                                                                  |
| 曹纯           | `mb_caochun`       | mobile   | 缮甲                                                                                         |
| 星徐晃         | `yj_xuhuang`       | newjiang | 治严                                                                                         |
| 星甘宁         | `yj_ganning`       | newjiang | 锦帆 / 射却                                                                                  |
| 星周不疑       | `yj_zhoubuyi`      | newjiang | 慧夭 / 雀颂                                                                                  |
| 骥李典         | **缺项**           | —        | 固定核心的断津可弃任意角色牌，移动版限本回合用过牌的其他角色；没有对应原生版本。             |
| 骥张辽         | **缺项**           | —        | 固定核心的荡势明确标为海外版本，加入第三选项与摸牌/加出杀次数；不采用此版本。                |

- 界伊籍 → `xf_yiji`：公告界伊籍，对应现有机捷/急援；原生译名不带界字。
- 界黄忠 → `re_huangzhong`：移动版界黄忠对应此原生烈弓；不是OL的烈弓/没矢。
- 界于禁 → `ol_yujin`：ID虽有ol前缀，但原生目录明确为mobile手杀界于禁，技能节钺；不是OL界于禁镇军/毅重。
- 刘协 → `liuxie`：天命／密诏与该平台版本相同；保留完整原生额外主公技坠廷及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/pc/hero-detail-61.html)
- 势陈到：[平台技能依据](https://www.sanguosha.cn/hero-detail-617.html)；排除 `pot_chendao`。
- 乐就：[平台技能依据](https://www.sanguosha.cn/hero-detail-630.html)；排除 `dc_yuejiu`、`yuejiu`。
- 阳球：[平台技能依据](https://www.sanguosha.cn/pc/hero-detail-651.html)；排除 `jsrg_yangqiu`。
- 骥李典：[平台技能依据](https://www.sanguosha.cn/pc/hero-detail-648.html)；排除 `hefei_lidian`。
- 骥张辽：[平台技能依据](https://www.sanguosha.cn/hero-detail-647.html)；排除 `hefei_zhangliao`。

## 一将成名全民赛S19（2026）

[官方公告](https://x.sanguosha.com/news/20260908_5740_2710.html)；发布于 2026-09-08。对应原活动2v2，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID                | 定义包   | 原生技能 / 缺项原因 |
| -------------- | --------------------- | -------- | ------------------- |
| 界郭嘉         | `re_guojia`           | refresh  | 天妒 / 遗计         |
| 界曹叡         | `re_caorui`           | refresh  | 恢拓 / 明鉴 / 兴衰  |
| 戏志才         | `xizhicai`            | sp       | 天妒 / 先辅 / 筹策  |
| 曹昂           | `caoang`              | sp       | 慷忾                |
| 夏侯杰         | `xiahoujie`           | huicui   | 裂胆 / 壮胆         |
| 界王异         | `re_wangyi`           | refresh  | 贞烈 / 秘计         |
| 庞会           | `panghui`             | huicui   | 异勇 / 夙仇         |
| 界陈群         | `dc_chenqun`          | refresh  | 品第 / 法恩         |
| 郝昭           | `haozhao`             | shenhua  | 镇骨                |
| 荀彧           | `xunyu`               | shenhua  | 驱虎 / 节命         |
| 牛金           | `re_niujin`           | sp2      | 摧锐 / 裂围         |
| 界张辽         | `re_zhangliao`        | refresh  | 突袭                |
| 界夏侯惇       | `re_xiahoudun`        | refresh  | 刚烈 / 清俭         |
| 界诸葛诞       | `re_zhugedan`         | refresh  | 功獒 / 举义         |
| 界杜畿         | `re_duji`             | refresh  | 安东 / 应势         |
| 界荀攸         | `re_xunyou`           | refresh  | 奇策 / 智愚         |
| 界司马懿       | `re_simayi`           | refresh  | 反馈 / 鬼才         |
| 唐咨           | `xf_tangzi`           | sp2      | 兴棹                |
| 界于禁         | `yujin_yujin`         | refresh  | 镇军                |
| 界郭皇后       | `re_guohuanghou`      | refresh  | 矫诏 / 殚心         |
| 界曹操         | `re_caocao`           | refresh  | 奸雄 / 护驾         |
| 界曹冲         | `re_caochong`         | refresh  | 称象 / 仁心         |
| 界曹休         | `re_caoxiu`           | refresh  | 千驹 / 倾袭         |
| 辛宪英         | `re_xinxianying`      | xianding | 忠鉴 / 才识         |
| 界张春华       | `re_zhangchunhua`     | refresh  | 绝情 / 伤逝         |
| 张郃           | `zhanghe`             | shenhua  | 巧变                |
| SP蔡文姬       | `sp_caiwenji`         | sp       | 陈情 / 默识         |
| 界张松         | `re_zhangsong`        | refresh  | 强识 / 献图         |
| 诸葛均         | `dc_zhugejun`         | huicui   | 耕读 / 孤脉         |
| 界关平         | `re_guanping`         | refresh  | 龙吟 / 竭忠         |
| 刘禅           | `liushan`             | shenhua  | 享乐 / 放权 / 若愚  |
| 界法正         | `re_fazheng`          | refresh  | 恩怨 / 眩惑         |
| 界张飞         | `re_zhangfei`         | refresh  | 咆哮 / 替身         |
| 诸葛瞻         | `zhugezhan`           | shenhua  | 罪论 / 父荫         |
| 界刘备         | `re_liubei`           | refresh  | 仁德 / 激将         |
| 界刘封         | `re_liufeng`          | refresh  | 陷嗣                |
| 沙摩柯         | `shamoke`             | sp       | 蒺藜                |
| 界关羽         | `re_guanyu`           | refresh  | 武圣 / 义绝         |
| 黄忠           | `re_huangzhong`       | shenhua  | 烈弓                |
| 秦宓           | `qinmi`               | yijiang  | 谏征 / 专对 / 天辩  |
| 界徐庶         | `re_xushu`            | refresh  | 诛害 / 潜心         |
| 糜芳傅士仁     | `sp_mifangfushiren`   | sp2      | 锋势                |
| 魏延           | `re_weiyan`           | shenhua  | 狂骨 / 奇谋         |
| 姜维           | `jiangwei`            | shenhua  | 挑衅 / 志继         |
| 界马超         | `re_machao`           | refresh  | 马术 / 铁骑         |
| 张星彩         | `zhangxingcai`        | sp       | 甚贤 / 枪舞         |
| 界诸葛亮       | `re_zhugeliang`       | refresh  | 观星 / 空城         |
| 关银屏         | `guanyinping`         | sp       | 虎啸 / 雪恨 / 武继  |
| 陆绩           | `luji`                | shenhua  | 怀橘 / 遗礼 / 整论  |
| 张怀           | `zhanghuai`           | xianding | dclaoyan / 诀言     |
| 界朱然         | `re_zhuran`           | refresh  | 胆守                |
| 界孙休         | `re_sunxiu`           | refresh  | 宴诛 / 兴学 / 诏缚  |
| 界朱治         | `re_zhuzhi`           | refresh  | 安国                |
| 界韩当         | `xin_handang`         | refresh  | 弓骑 / 解烦         |
| 界黄盖         | `re_huanggai`         | refresh  | 苦肉 / 诈降         |
| 谋吕蒙         | `dc_sb_lvmeng`        | xianding | 横野 / 英博         |
| 界孙权         | `re_sunquan`          | refresh  | 制衡 / 救援         |
| 界孙尚香       | `re_sunshangxiang`    | refresh  | 枭姬 / 结姻         |
| 陆抗           | `lukang`              | shenhua  | 谦节 / 决堰 / 破势  |
| 小乔           | `xiaoqiao`            | shenhua  | 天香 / 红颜         |
| 孙策           | `sunce`               | shenhua  | 激昂 / 魂姿 / 制霸  |
| 界徐盛         | `xin_xusheng`         | refresh  | 破军                |
| 鲁肃           | `re_lusu`             | shenhua  | 好施 / 缔盟         |
| 界吴国太       | `xin_wuguotai`        | refresh  | 甘露 / 补益         |
| 界孙登         | `re_sundeng`          | refresh  | 匡弼                |
| 吉邈吉穆       | `jimiaojimu`          | huicui   | 诹议 / 掩袭         |
| 潘凤           | `re_panfeng`          | huicui   | 狂斧                |
| 樊玉凤         | `fanyufeng`           | xianding | 把盏 / 醮影         |
| 张绣           | `zhangxiu`            | shenhua  | 雄乱 / 从谏 / 踞襄  |
| 许攸           | `xuyou`               | shenhua  | 成略 / 恃才 / 寸目  |
| 南华老仙       | `re_nanhualaoxian`    | sp2      | 共修 / 经合         |
| 界SP黄月英     | `re_jsp_huangyueying` | refresh  | 机巧 / 玲珑         |
| 界陈宫         | `re_chengong`         | refresh  | 明策 / 智迟         |
| 界公孙瓒       | `re_gongsunzan`       | refresh  | 趫猛 / 义从         |
| 吕布           | `lvbu`                | standard | 无双                |
| 淳于琼         | `re_chunyuqiong`      | huicui   | 仓储 / 粮营 / 失守  |
| 刘协           | `liuxie`              | sp       | 天命 / 密诏 / 坠廷  |
| 界沮授         | `re_jushou`           | refresh  | 渐营 / 矢北         |
| SP赵云         | `sp_zhaoyun`          | sp       | 龙胆 / 冲阵         |
| 张济           | `zhangji`             | sp2      | 掠命 / 屯军         |
| 王荣           | `wangrong`            | sp2      | 敏思 / 吉境 / 追德  |
| 张角           | `sp_zhangjiao`        | shenhua  | 雷击 / 鬼道 / 黄天  |
| 界高顺         | `xin_gaoshun`         | refresh  | 陷阵 / 禁酒         |
| 马日磾         | `mamidi`              | huicui   | 秉节 / 正订         |
| 界貂蝉         | `re_diaochan`         | refresh  | 离间 / 闭月         |
| 界郭图逢纪     | `re_guotufengji`      | refresh  | 急攻 / 饰非         |
| 曹性           | `caoxing`             | huicui   | 流矢 / 斩腕         |
| 界SP太史慈     | `re_sp_taishici`      | refresh  | 击虚                |
| 麴义           | `re_quyi`             | sp2      | 伏骑 / 骄恣         |
| 张宝           | `re_zhangbao`         | xianding | 咒缚 / 影兵         |

- 黄忠 → `re_huangzhong`：移动版界黄忠对应此原生烈弓；不是OL的烈弓/没矢。
- 张绣 → `zhangxiu`：雄乱／从谏与该平台版本相同；保留完整原生额外主公技踞襄及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.com/hero/415)
- 淳于琼 → `re_chunyuqiong`：一将成名常规版仓储/粮营/失守、4体力；不是sp2官渡活动场的5体力宿守版。 [版本依据](https://x.sanguosha.com/hero/953.html)
- 刘协 → `liuxie`：天命／密诏与该平台版本相同；保留完整原生额外主公技坠廷及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/pc/hero-detail-61.html)

## 移动版群雄逐鹿第十二届（2024）

[官方公告](https://www.sanguosha.cn/pc/news-detail-1947.html) · [公告将池原图](https://www.sanguosha.cn/storage/uploads/images/p646yIxewSpDzRJlSTkfJ1SCuugAfKExg06pAjua.png)；发布于 2024-11-06。对应原活动2v2，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID              | 定义包   | 原生技能 / 缺项原因       |
| -------------- | ------------------- | -------- | ------------------------- |
| SP孙策         | `sp_sunce`          | sp       | 连讨                      |
| 蒋钦           | `sp_jiangqing`      | shiji    | 俭衣 / 尚义               |
| 周处           | `zhouchu`           | shiji    | 乡害 / 除害               |
| 星周不疑       | `yj_zhoubuyi`       | newjiang | 慧夭 / 雀颂               |
| 张松           | `zhangsong`         | yijiang  | 强识 / 献图               |
| 星徐晃         | `yj_xuhuang`        | newjiang | 治严                      |
| 李遗           | `liwei`             | mobile   | 教化                      |
| 星魏延         | `yj_weiyan`         | newjiang | 孤厉 / 骜肆               |
| 玄毌丘俭       | `mb_sp_guanqiujian` | mobile   | 摧阵 / 溃离               |
| 界全琮         | `xin_quancong`      | mobile   | 邀名                      |
| 界吴懿         | `xin_wuyi`          | mobile   | 奔袭                      |
| 界孙尚香       | `re_sunshangxiang`  | refresh  | 枭姬 / 结姻               |
| 界孙权         | `re_sunquan`        | refresh  | 制衡 / 救援               |
| 界廖化         | `xin_liaohua`       | mobile   | 当先 / 伏枥               |
| 界朱桓         | `xin_zhuhuan`       | mobile   | 奋励 / 平寇               |
| 界步练师       | `re_bulianshi`      | mobile   | 安恤 / 追忆               |
| 张昌蒲         | `sp_zhangchangpu`   | shiji    | 抵诽 / 严教               |
| 刘焉           | `liuyan`            | sp       | 图射 / 立牧               |
| 苏飞           | `sp_sufei`          | mobile   | 诤荐 / 告援               |
| 裴秀           | `peixiu`            | mobile   | 行图 / 爵制               |
| 许攸           | `junk_xuyou`        | diy      | 成略 / 恃才 / 寸目        |
| 谋卢植         | `sb_yl_luzhi`       | sb       | 明任 / 卫旒               |
| 谋孙尚香       | `sb_sunshangxiang`  | sb       | 结姻 / 良助 / 枭姬        |
| 谋孙策         | `sb_sunce`          | sb       | 激昂 / 魂姿 / 制霸        |
| 谋荀彧         | `sb_xunyu`          | sb       | 驱虎 / 节命               |
| 郭女王         | `guohuanghou`       | yijiang  | 矫诏 / 殚心               |
| 阎圃           | `yanpu`             | mobile   | 缓图 / 避祸               |
| 张琪瑛         | `zhangqiying`       | sp       | 法箓 / 点化 / 真仪        |
| 陈珪           | `mb_chengui`        | mobile   | 诡谋 / 州贤               |
| 鲁芝           | `luzhi`             | sp       | 清忠 / 卫境               |
| 界黄盖         | `re_huanggai`       | refresh  | 苦肉 / 诈降               |
| 潘濬           | `panjun`            | sp       | 观微 / 公清               |
| 吴景           | `wujing`            | shiji    | 合击 / 流兵               |
| 界荀彧         | `re_xunyu`          | mobile   | 驱虎 / 节命               |
| 彭羕           | `sp_pengyang`       | mobile   | 达命 / 嚣逆               |
| 刘璋           | `liuzhang`          | shiji    | 据土 / 邀虎 / 怀璧        |
| SP貂蝉         | `sp_diaochan`       | sp       | 离魂 / 闭月               |
| 张恭           | `re_zhanggong`      | mobile   | 遣信 / 镇行               |
| 刘琦           | `sp_liuqi`          | sp2      | 问计 / 屯江               |
| 崔琰           | `sp_cuiyan`         | shiji    | 雅俊 / 尊嫡               |
| 谋周瑜         | `sb_zhouyu`         | sb       | 英姿 / 反间               |
| 张翼           | `zhangyì`           | mobile   | 执义                      |
| 高览           | `sp_gaolan`         | shiji    | 峻攻 / 等力               |
| 陆绩           | `luji`              | shenhua  | 怀橘 / 遗礼 / 整论        |
| 马元义         | `mayuanyi`          | mobile   | 集兵 / 往京 / 谋篡        |
| 木鹿大王       | `muludawang`        | mobile   | 兽法 / 咒鳞 / 御象        |
| 毛玠           | `sp_maojie`         | mobile   | 秉清 / 迎奉               |
| 沙摩柯         | `shamoke`           | sp       | 蒺藜                      |
| 陈琳           | `chenlin`           | sp       | 笔伐 / 颂词               |
| 王粲           | `sp_wangcan`        | shiji    | 七哀 / 善檄               |
| 界伊籍         | `xf_yiji`           | standard | 机捷 / 急援               |
| 界关羽         | `re_guanyu`         | refresh  | 武圣 / 义绝               |
| 界刘备         | `re_liubei`         | refresh  | 仁德 / 激将               |
| 界孙休         | `xin_sunxiu`        | mobile   | 宴诛 / 兴学 / 诏缚        |
| 谋高顺         | `sb_gaoshun`        | sb       | 陷阵 / 禁酒               |
| 杨奉           | `yangfeng`          | mobile   | 血途 / 威命               |
| 刘协           | `liuxie`            | sp       | 天命 / 密诏 / 坠廷        |
| 界曹真         | `xin_caozhen`       | mobile   | 司敌                      |
| 界朱然         | `xin_zhuran`        | mobile   | 胆守                      |
| 界满宠         | `re_manchong`       | refresh  | 峻刑 / 御策               |
| 界蔡夫人       | `xin_caifuren`      | mobile   | 窃听 / 献州               |
| 袁涣           | `yuanhuan`          | shiji    | 请决 / 奉节               |
| 费祎           | `feiyi`             | shiji    | 生息 / 谏喻               |
| 界郭嘉         | `re_guojia`         | refresh  | 天妒 / 遗计               |
| 界陈群         | `re_chenqun`        | mobile   | 定品 / 法恩               |
| 界魏延         | `ol_weiyan`         | refresh  | 狂骨 / 奇谋               |
| 关平           | `guanping`          | yijiang  | 龙吟                      |
| 神吕蒙         | `shen_lvmeng`       | extra    | 涉猎 / 攻心               |
| 程昱           | `mb_chengyu`        | mobile   | 设伏 / 贲育               |
| 糜竺           | `mizhu`             | sp       | 资援 / 巨贾               |
| 谋徐晃         | `sb_xuhuang`        | sb       | 断粮 / 势迫               |
| 蒋干           | `sp_jianggan`       | mobile   | 盗书 / 戴罪               |
| 谋祝融         | `sb_zhurong`        | sb       | 烈刃 / 巨象               |
| 谋陈宫         | `sb_chengong`       | sb       | 明策 / 智迟               |
| 谯周           | `qiaozhou`          | mobile   | 知命 / 星卜               |
| 贾逵           | `jiakui`            | mobile   | 通渠 / 挽澜               |
| 霍峻           | `xin_huojun`        | mobile   | 伺怠 / 竭御               |
| 谋法正         | `sb_fazheng`        | sb       | 眩惑 / 恩怨               |
| SP蔡文姬       | `sp_caiwenji`       | sp       | 陈情 / 默识               |
| 公孙康         | `gongsunkang`       | mobile   | 据辽 / 讨灭               |
| 刘巴           | `liuba`             | shiji    | 锻币 / 统度               |
| 界张辽         | `re_zhangliao`      | refresh  | 突袭                      |
| 刘封           | `liufeng`           | yijiang  | 陷嗣                      |
| 界貂蝉         | `re_diaochan`       | refresh  | 离间 / 闭月               |
| 吴班           | `xin_wuban`         | mobile   | 进讨                      |
| 周鲂           | `zhoufang`          | sp       | 断发 / 诱敌               |
| 孙乾           | `sunqian`           | sp       | 谦雅 / 说盟               |
| 审配           | `shenpei`           | mobile   | 守邺 / 烈直               |
| SP赵云         | `sp_zhaoyun`        | sp       | 龙胆 / 冲阵               |
| 李丰           | `lifeng`            | mobile   | 屯储 / 输粮               |
| 步骘           | `buzhi`             | sp       | 弘德 / 定叛               |
| 王凌           | `wangling`          | shiji    | 星启 / 自缚 / 秘备        |
| 王平           | `wangping`          | shenhua  | 飞军 / 兵略               |
| 界吕布         | `re_lvbu`           | refresh  | 无双 / 利驭               |
| 界姜维         | `re_jiangwei`       | mobile   | 挑衅 / 志继               |
| 界孙策         | `re_sunce`          | refresh  | 激昂 / 魂姿 / 制霸        |
| 界朱治         | `xin_zhuzhi`        | mobile   | 安国                      |
| 界法正         | `re_fazheng`        | refresh  | 恩怨 / 眩惑               |
| 界王异         | `re_wangyi`         | refresh  | 贞烈 / 秘计               |
| 界甄姬         | `re_zhenji`         | refresh  | 洛神 / 倾国               |
| 界蔡文姬       | `re_caiwenji`       | mobile   | 悲歌 / 断肠               |
| 界马超         | `re_machao`         | refresh  | 马术 / 铁骑               |
| 界张角         | `re_zhangjiao`      | refresh  | 雷击 / 鬼道 / 黄天        |
| 神吕布         | `mb_shen_lvbu`      | mobile   | 狂暴 / 无谋 / 无前 / 神愤 |
| 神周瑜         | `shen_zhouyu`       | extra    | 业炎 / 琴音               |
| 秦宓           | `qinmi`             | yijiang  | 谏征 / 专对 / 天辩        |
| 羊祜           | `sp_yanghu`         | shiji    | 明伐 / 戎备               |
| 诸葛恪         | `zhugeke`           | sp       | 傲才 / 黩武               |
| 谋于禁         | `sb_yujin`          | sb       | 狭援 / 节钺               |
| 谋刘赪         | `liucheng`          | sb       | 掠影 / 莺舞               |
| 谋孟获         | `sb_menghuo`        | sb       | 祸首 / 再起               |
| 谋庞统         | `sb_pangtong`       | sb       | 连环 / 涅槃               |
| 钟繇           | `mb_zhongyao`       | mobile   | 活墨 / 佐定               |
| 孙茹           | `sunru`             | mobile   | 影箭 / 释衅               |
| 王基           | `wangji`            | shenhua  | 奇制 / 进趋               |
| 谋吕蒙         | `sb_lvmeng`         | sb       | 克己 / 渡江               |
| 谋华雄         | `sb_huaxiong`       | sb       | 耀武 / 扬威               |
| 界许褚         | `re_xuzhu`          | refresh  | 裸衣                      |
| 董允           | `dongyun`           | sp       | 秉正 / 舍宴               |
| 界黄忠         | `re_huangzhong`     | shenhua  | 烈弓                      |

- 许攸 → `junk_xuyou`：原生内置diy包收纳手杀许攸的成略/恃才/寸目；不是自创角色或技能。
- 郭女王 → `guohuanghou`：公告郭女王与原生郭皇后为同一版本别名。
- 界伊籍 → `xf_yiji`：公告界伊籍，对应现有机捷/急援；原生译名不带界字。
- 刘协 → `liuxie`：天命／密诏与该平台版本相同；保留完整原生额外主公技坠廷及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/pc/hero-detail-61.html)
- 界黄忠 → `re_huangzhong`：移动版界黄忠对应此原生烈弓；不是OL的烈弓/没矢。

## 移动版群雄逐鹿第十六届（2025）

[官方公告](https://www.sanguosha.cn/pc/news-detail-2059.html) · [公告将池原图](https://www.sanguosha.cn/storage/uploads/images/l1EsoVGHG7lkQOM2onbQVeQ5rdJcvmS1Z2KUgI6v.png)；发布于 2025-04-28。对应原活动2v2，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID              | 定义包   | 原生技能 / 缺项原因                                                                        |
| -------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------ |
| SP孙策         | `sp_sunce`          | sp       | 连讨                                                                                       |
| 鲍信           | `baoxin`            | mobile   | 募讨 / 毅谋                                                                                |
| 朱儁           | `sp_zhujun`         | shiji    | 佯解 / 拒降 / 厚俸                                                                         |
| 高览           | `sp_gaolan`         | shiji    | 峻攻 / 等力                                                                                |
| 张松           | `zhangsong`         | yijiang  | 强识 / 献图                                                                                |
| 星徐晃         | `yj_xuhuang`        | newjiang | 治严                                                                                       |
| 李遗           | `liwei`             | mobile   | 教化                                                                                       |
| 曹嵩           | `sp_caosong`        | mobile   | 亿金 / 惯纵                                                                                |
| 玄毌丘俭       | `mb_sp_guanqiujian` | mobile   | 摧阵 / 溃离                                                                                |
| 界全琮         | `xin_quancong`      | mobile   | 邀名                                                                                       |
| 界吴懿         | `xin_wuyi`          | mobile   | 奔袭                                                                                       |
| 胡金定         | `hujinding`         | mobile   | 仁释 / 武缘 / 怀子                                                                         |
| 界孙权         | `re_sunquan`        | refresh  | 制衡 / 救援                                                                                |
| 界廖化         | `xin_liaohua`       | mobile   | 当先 / 伏枥                                                                                |
| 木鹿大王       | `muludawang`        | mobile   | 兽法 / 咒鳞 / 御象                                                                         |
| 界步练师       | `re_bulianshi`      | mobile   | 安恤 / 追忆                                                                                |
| 谋郭嘉         | `sb_guojia`         | sb       | 天妒 / 遗计                                                                                |
| 谋诸葛瑾       | `sb_zhugejin`       | sb       | 缓释 / 弘援 / 明哲                                                                         |
| 诸葛瞻         | `zhugezhan`         | shenhua  | 罪论 / 父荫                                                                                |
| 裴秀           | `peixiu`            | mobile   | 行图 / 爵制                                                                                |
| 许攸           | `junk_xuyou`        | diy      | 成略 / 恃才 / 寸目                                                                         |
| 谋卢植         | `sb_yl_luzhi`       | sb       | 明任 / 卫旒                                                                                |
| 友徐庶         | **缺项**            | —        | 固定核心的启诲明确标为海外版本，增加了援助其他角色与标记上限成长；移动版原生版本已被覆盖。 |
| 谋孙策         | `sb_sunce`          | sb       | 激昂 / 魂姿 / 制霸                                                                         |
| 谋荀彧         | `sb_xunyu`          | sb       | 驱虎 / 节命                                                                                |
| 李昭焦伯       | `lizhaojiaobo`      | mobile   | 佐佑 / 侍守                                                                                |
| 文钦           | `mb_wenqin`         | mobile   | 孛明 / 仇铓                                                                                |
| 谋韩当         | `sb_handang`        | sb       | 弓骑 / 解烦                                                                                |
| 陈珪           | `mb_chengui`        | mobile   | 诡谋 / 州贤                                                                                |
| 鲁芝           | `luzhi`             | sp       | 清忠 / 卫境                                                                                |
| 界黄盖         | `re_huanggai`       | refresh  | 苦肉 / 诈降                                                                                |
| 潘濬           | `panjun`            | sp       | 观微 / 公清                                                                                |
| 界顾雍         | `xin_guyong`        | mobile   | 慎行 / 秉壹                                                                                |
| 界荀彧         | `re_xunyu`          | mobile   | 驱虎 / 节命                                                                                |
| 贾充           | `mb_jiachong`       | mobile   | 悖逆 / 定法                                                                                |
| 谋贾诩         | `sb_jiaxu`          | sb       | 完杀 / 乱武 / 帷幕                                                                         |
| 谋张辽         | `sb_zhangliao`      | sb       | 突袭 / 登锋                                                                                |
| 桥公           | `qiaogong`          | shiji    | 遗珠 / 鸾俦                                                                                |
| 刘琦           | `sp_liuqi`          | sp2      | 问计 / 屯江                                                                                |
| 崔琰           | `sp_cuiyan`         | shiji    | 雅俊 / 尊嫡                                                                                |
| 谋周瑜         | `sb_zhouyu`         | sb       | 英姿 / 反间                                                                                |
| 张翼           | `zhangyì`           | mobile   | 执义                                                                                       |
| 星周不疑       | `yj_zhoubuyi`       | newjiang | 慧夭 / 雀颂                                                                                |
| 陆绩           | `luji`              | shenhua  | 怀橘 / 遗礼 / 整论                                                                         |
| 马元义         | `mayuanyi`          | mobile   | 集兵 / 往京 / 谋篡                                                                         |
| 界朱桓         | `xin_zhuhuan`       | mobile   | 奋励 / 平寇                                                                                |
| 毛玠           | `sp_maojie`         | mobile   | 秉清 / 迎奉                                                                                |
| 沙摩柯         | `shamoke`           | sp       | 蒺藜                                                                                       |
| 陈琳           | `chenlin`           | sp       | 笔伐 / 颂词                                                                                |
| 王粲           | `sp_wangcan`        | shiji    | 七哀 / 善檄                                                                                |
| 谋马超         | `sb_machao`         | sb       | 马术 / 铁骑                                                                                |
| 界关羽         | `re_guanyu`         | refresh  | 武圣 / 义绝                                                                                |
| 界刘备         | `re_liubei`         | refresh  | 仁德 / 激将                                                                                |
| 张琪瑛         | `zhangqiying`       | sp       | 法箓 / 点化 / 真仪                                                                         |
| 谋高顺         | `sb_gaoshun`        | sb       | 陷阵 / 禁酒                                                                                |
| 杨奉           | `yangfeng`          | mobile   | 血途 / 威命                                                                                |
| 界孙尚香       | `re_sunshangxiang`  | refresh  | 枭姬 / 结姻                                                                                |
| 界曹真         | `xin_caozhen`       | mobile   | 司敌                                                                                       |
| 界朱然         | `xin_zhuran`        | mobile   | 胆守                                                                                       |
| 界满宠         | `re_manchong`       | refresh  | 峻刑 / 御策                                                                                |
| 界蔡夫人       | `xin_caifuren`      | mobile   | 窃听 / 献州                                                                                |
| 袁涣           | `yuanhuan`          | shiji    | 请决 / 奉节                                                                                |
| 谋夏侯渊       | `sb_xiahouyuan`     | sb       | 神速 / 整辎                                                                                |
| 娄圭           | `pot_lougui`        | bingshi  | 灌沙 / 急御                                                                                |
| 谋郭淮         | `sb_guohuai`        | sb       | 精策                                                                                       |
| 司马伷         | `mb_simazhou`       | mobile   | 避锋 / 宿望                                                                                |
| 王平           | `wangping`          | shenhua  | 飞军 / 兵略                                                                                |
| 神吕蒙         | `shen_lvmeng`       | extra    | 涉猎 / 攻心                                                                                |
| 司马孚         | `mb_simafu`         | mobile   | 蹒襄 / 臣节                                                                                |
| 糜竺           | `mizhu`             | sp       | 资援 / 巨贾                                                                                |
| 谋徐晃         | `sb_xuhuang`        | sb       | 断粮 / 势迫                                                                                |
| 蒋干           | `sp_jianggan`       | mobile   | 盗书 / 戴罪                                                                                |
| 谋祝融         | `sb_zhurong`        | sb       | 烈刃 / 巨象                                                                                |
| 秦宓           | `qinmi`             | yijiang  | 谏征 / 专对 / 天辩                                                                         |
| 谯周           | `qiaozhou`          | mobile   | 知命 / 星卜                                                                                |
| 贾逵           | `jiakui`            | mobile   | 通渠 / 挽澜                                                                                |
| 李丰           | `lifeng`            | mobile   | 屯储 / 输粮                                                                                |
| 郝昭           | `haozhao`           | shenhua  | 镇骨                                                                                       |
| 薛综           | `mb_xuezong`        | mobile   | 复难 / 诫训                                                                                |
| 沮授           | `yj_jushou`         | yijiang  | 渐营 / 矢北                                                                                |
| 宗预           | `sp_zongyu`         | shiji    | 直辩 / 御严                                                                                |
| 界张辽         | `re_zhangliao`      | refresh  | 突袭                                                                                       |
| 刘封           | `liufeng`           | yijiang  | 陷嗣                                                                                       |
| 界貂蝉         | `re_diaochan`       | refresh  | 离间 / 闭月                                                                                |
| 王朗           | `wanglang`          | xianding | 鼓舌 / 激词                                                                                |
| 星张郃         | `yj_zhanghe`        | newjiang | 知略                                                                                       |
| 来敏           | `laimin`            | mobile   | 来寿 / 乱群                                                                                |
| 审配           | `shenpei`           | mobile   | 守邺 / 烈直                                                                                |
| SP赵云         | `sp_zhaoyun`        | sp       | 龙胆 / 冲阵                                                                                |
| 杨阜           | `yangfu`            | mobile   | 借兵 / 扞难                                                                                |
| 界周仓         | `xin_zhoucang`      | mobile   | 忠勇                                                                                       |
| 吴班           | `xin_wuban`         | mobile   | 进讨                                                                                       |
| 贺齐           | `re_heqi`           | mobile   | 绮胄 / 闪袭                                                                                |
| 界吕布         | `re_lvbu`           | refresh  | 无双 / 利驭                                                                                |
| 陆抗           | `lukang`            | shenhua  | 谦节 / 决堰 / 破势                                                                         |
| 刘协           | `liuxie`            | sp       | 天命 / 密诏 / 坠廷                                                                         |
| 界魏延         | `ol_weiyan`         | refresh  | 狂骨 / 奇谋                                                                                |
| 界法正         | `re_fazheng`        | refresh  | 恩怨 / 眩惑                                                                                |
| 程昱           | `mb_chengyu`        | mobile   | 设伏 / 贲育                                                                                |
| 界甄姬         | `re_zhenji`         | refresh  | 洛神 / 倾国                                                                                |
| 界姜维         | `re_jiangwei`       | mobile   | 挑衅 / 志继                                                                                |
| 界马超         | `re_machao`         | refresh  | 马术 / 铁骑                                                                                |
| 界张角         | `re_zhangjiao`      | refresh  | 雷击 / 鬼道 / 黄天                                                                         |
| 关平           | `guanping`          | yijiang  | 龙吟                                                                                       |
| 丁原           | `dingyuan`          | mobile   | 备诛                                                                                       |
| 凌操           | `lingcao`           | mobile   | 独进                                                                                       |
| 羊祜           | `sp_yanghu`         | shiji    | 明伐 / 戎备                                                                                |
| 诸葛恪         | `zhugeke`           | sp       | 傲才 / 黩武                                                                                |
| 王经           | `mb_wangjing`       | mobile   | 阻进 / 节谏                                                                                |
| 谋刘赪         | `liucheng`          | sb       | 掠影 / 莺舞                                                                                |
| 友庞统         | `friend_pangtong`   | mobile   | 漫卷 / 养名 / 共砺                                                                         |
| 荀攸           | `xunyou`            | yijiang  | 奇策 / 智愚                                                                                |
| 钟繇           | `mb_zhongyao`       | mobile   | 活墨 / 佐定                                                                                |
| 孙茹           | `sunru`             | mobile   | 影箭 / 释衅                                                                                |
| 王基           | `wangji`            | shenhua  | 奇制 / 进趋                                                                                |
| 界伊籍         | `xf_yiji`           | standard | 机捷 / 急援                                                                                |
| 谋华雄         | `sb_huaxiong`       | sb       | 耀武 / 扬威                                                                                |
| 界许褚         | `re_xuzhu`          | refresh  | 裸衣                                                                                       |
| 董允           | `dongyun`           | sp       | 秉正 / 舍宴                                                                                |
| 界黄忠         | `re_huangzhong`     | shenhua  | 烈弓                                                                                       |

- 许攸 → `junk_xuyou`：原生内置diy包收纳手杀许攸的成略/恃才/寸目；不是自创角色或技能。
- 文钦 → `mb_wenqin`：公告简称文钦，对应移动版玄文钦孛明/仇铓；不使用OL犷骜/彗企。 [版本依据](https://www.sanguosha.cn/hero-detail-594.html)
- 娄圭 → `pot_lougui`：公告简称娄圭，对应移动版势娄圭灌沙/急御。
- 星张郃 → `yj_zhanghe`：公告星张郃；原生译名☆张郃，使用移动版知略。 [版本依据](https://www.sanguosha.cn/hero-detail-378.html)
- 刘协 → `liuxie`：天命／密诏与该平台版本相同；保留完整原生额外主公技坠廷及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/pc/hero-detail-61.html)
- 界伊籍 → `xf_yiji`：公告界伊籍，对应现有机捷/急援；原生译名不带界字。
- 界黄忠 → `re_huangzhong`：移动版界黄忠对应此原生烈弓；不是OL的烈弓/没矢。
- 友徐庶：[平台技能依据](https://www.sanguosha.cn/pc/hero-detail-606.html)；排除 `friend_xushu`。

## OL排位基础池（2026年10月）

[官方公告](https://www.sanguosha.com/news/20260922_1251_1414)；发布于 2026-09-30。对应原活动2v2，本项目可用于现有四模式。

公告基础表按官方名去重151将（许褚重复一格），不加入进阶表。

| 公告／目录武将 | 原生ID               | 定义包   | 原生技能 / 缺项原因                                                                                                                              |
| -------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 刘备           | `liubei`             | standard | 仁德 / 激将                                                                                                                                      |
| 关羽           | `guanyu`             | standard | 武圣                                                                                                                                             |
| 张飞           | `zhangfei`           | standard | 咆哮                                                                                                                                             |
| 诸葛亮         | `zhugeliang`         | standard | 观星 / 空城                                                                                                                                      |
| 赵云           | `zhaoyun`            | standard | 龙胆                                                                                                                                             |
| 马超           | `machao`             | standard | 马术 / 铁骑                                                                                                                                      |
| 黄月英         | `huangyueying`       | standard | 集智 / 奇才                                                                                                                                      |
| 孙权           | `sunquan`            | standard | 制衡 / 救援                                                                                                                                      |
| 甘宁           | `ganning`            | standard | 奇袭                                                                                                                                             |
| 吕蒙           | `lvmeng`             | standard | 克己                                                                                                                                             |
| 黄盖           | `huanggai`           | standard | 苦肉                                                                                                                                             |
| 周瑜           | `zhouyu`             | standard | 英姿 / 反间                                                                                                                                      |
| 陆逊           | `luxun`              | standard | 谦逊 / 连营                                                                                                                                      |
| 曹操           | `caocao`             | standard | 奸雄 / 护驾                                                                                                                                      |
| 司马懿         | `simayi`             | standard | 反馈 / 鬼才                                                                                                                                      |
| 夏侯惇         | `xiahoudun`          | standard | 刚烈                                                                                                                                             |
| 张辽           | `zhangliao`          | standard | 突袭                                                                                                                                             |
| 许褚           | `xuzhu`              | standard | 裸衣                                                                                                                                             |
| 郭嘉           | `guojia`             | standard | 天妒 / 遗计                                                                                                                                      |
| 甄姬           | `zhenji`             | standard | 洛神 / 倾国                                                                                                                                      |
| 吕布           | `lvbu`               | standard | 无双                                                                                                                                             |
| 貂蝉           | `diaochan`           | standard | 离间 / 闭月                                                                                                                                      |
| 孙尚香         | `sunshangxiang`      | standard | 枭姬 / 结姻                                                                                                                                      |
| 标华雄         | `huaxiong`           | standard | 耀武                                                                                                                                             |
| 魏延           | `re_weiyan`          | shenhua  | 狂骨 / 奇谋                                                                                                                                      |
| 小乔           | `xiaoqiao`           | shenhua  | 天香 / 红颜                                                                                                                                      |
| 典韦           | `dianwei`            | shenhua  | 强袭                                                                                                                                             |
| 荀彧           | `xunyu`              | shenhua  | 驱虎 / 节命                                                                                                                                      |
| 庞德           | `re_pangde`          | shenhua  | 马术 / 鞬出                                                                                                                                      |
| 袁绍           | `re_yuanshao`        | shenhua  | 乱击 / 血裔                                                                                                                                      |
| 刘禅           | `liushan`            | shenhua  | 享乐 / 放权 / 若愚                                                                                                                               |
| 孙策           | `sunce`              | shenhua  | 激昂 / 魂姿 / 制霸                                                                                                                               |
| 张角           | `sp_zhangjiao`       | shenhua  | 雷击 / 鬼道 / 黄天                                                                                                                               |
| 王基           | `wangji`             | shenhua  | 奇制 / 进趋                                                                                                                                      |
| 王平           | `wangping`           | shenhua  | 飞军 / 兵略                                                                                                                                      |
| 郝昭           | `haozhao`            | shenhua  | 镇骨                                                                                                                                             |
| 诸葛瞻         | `zhugezhan`          | shenhua  | 罪论 / 父荫                                                                                                                                      |
| 陆抗           | `lukang`             | shenhua  | 谦节 / 决堰 / 破势                                                                                                                               |
| 张绣           | `zhangxiu`           | shenhua  | 雄乱 / 从谏 / 踞襄                                                                                                                               |
| 陈宫           | `chengong`           | yijiang  | 明策 / 智迟                                                                                                                                      |
| 张春华         | `zhangchunhua`       | yijiang  | 绝情 / 伤逝                                                                                                                                      |
| 荀攸           | `xunyou`             | yijiang  | 奇策 / 智愚                                                                                                                                      |
| 郭淮           | `guohuai`            | yijiang  | 精策                                                                                                                                             |
| 刘封           | `liufeng`            | yijiang  | 陷嗣                                                                                                                                             |
| 法正           | `xin_fazheng`        | yijiang  | 眩惑 / 恩怨                                                                                                                                      |
| 关兴张苞       | `guanzhang`          | yijiang  | 父魂                                                                                                                                             |
| 陈群           | `chenqun`            | yijiang  | 品第 / 法恩                                                                                                                                      |
| 周仓           | `zhoucang`           | yijiang  | 忠勇                                                                                                                                             |
| 张松           | `zhangsong`          | yijiang  | 强识 / 献图                                                                                                                                      |
| 朱桓           | `zhuhuan`            | yijiang  | 奋励 / 平寇                                                                                                                                      |
| 沮授           | `yj_jushou`          | yijiang  | 渐营 / 矢北                                                                                                                                      |
| 钟繇           | `zhongyao`           | yijiang  | 活墨 / 佐定                                                                                                                                      |
| 夏侯氏         | `xiahoushi`          | yijiang  | 樵拾 / 燕语                                                                                                                                      |
| 嵇康           | `jikang`             | yijiang  | 清弦 / 绝响                                                                                                                                      |
| 秦宓           | `qinmi`              | yijiang  | 谏征 / 专对 / 天辩                                                                                                                               |
| 界黄忠         | `re_huangzhong`      | shenhua  | 烈弓                                                                                                                                             |
| 界刘备         | `re_liubei`          | refresh  | 仁德 / 激将                                                                                                                                      |
| 界关羽         | `re_guanyu`          | refresh  | 武圣 / 义绝                                                                                                                                      |
| 界张飞         | `re_zhangfei`        | refresh  | 咆哮 / 替身                                                                                                                                      |
| 界赵云         | `re_zhaoyun`         | refresh  | 龙胆 / 涯角                                                                                                                                      |
| 界马超         | `re_machao`          | refresh  | 马术 / 铁骑                                                                                                                                      |
| 界甘宁         | `re_ganning`         | refresh  | 奇袭 / 奋威                                                                                                                                      |
| 界黄盖         | `re_huanggai`        | refresh  | 苦肉 / 诈降                                                                                                                                      |
| 界周瑜         | `re_zhouyu`          | refresh  | 英姿 / 反间                                                                                                                                      |
| 界陆逊         | `re_luxun`           | refresh  | 谦逊 / 连营                                                                                                                                      |
| 界曹操         | `re_caocao`          | refresh  | 奸雄 / 护驾                                                                                                                                      |
| 界张辽         | `re_zhangliao`       | refresh  | 突袭                                                                                                                                             |
| 界许褚         | `re_xuzhu`           | refresh  | 裸衣                                                                                                                                             |
| 界郭嘉         | `re_guojia`          | refresh  | 天妒 / 遗计                                                                                                                                      |
| 界李典         | `re_lidian`          | refresh  | 恂恂 / 忘隙                                                                                                                                      |
| 界吕布         | `re_lvbu`            | refresh  | 无双 / 利驭                                                                                                                                      |
| 界诸葛亮       | `re_zhugeliang`      | refresh  | 观星 / 空城                                                                                                                                      |
| 界黄月英       | `re_huangyueying`    | refresh  | 集智 / 奇才                                                                                                                                      |
| 界孙权         | `re_sunquan`         | refresh  | 制衡 / 救援                                                                                                                                      |
| 界孙尚香       | `re_sunshangxiang`   | refresh  | 枭姬 / 结姻                                                                                                                                      |
| 界甄姬         | `re_zhenji`          | refresh  | 洛神 / 倾国                                                                                                                                      |
| 界貂蝉         | `re_diaochan`        | refresh  | 离间 / 闭月                                                                                                                                      |
| 界华雄         | `re_huaxiong`        | refresh  | 耀武 / 势斩                                                                                                                                      |
| 界张角         | `re_zhangjiao`       | refresh  | 雷击 / 鬼道 / 黄天                                                                                                                               |
| 界刘禅         | `ol_liushan`         | refresh  | 享乐 / 放权 / 若愚                                                                                                                               |
| 界孙策         | `re_sunce`           | refresh  | 激昂 / 魂姿 / 制霸                                                                                                                               |
| 界孙坚         | `ol_sunjian`         | refresh  | 英魂 / 武烈 / 破虏                                                                                                                               |
| 界庞德         | `ol_pangde`          | refresh  | 马术 / 鞬出                                                                                                                                      |
| 界太史慈       | `re_taishici`        | refresh  | 天义 / 酣战                                                                                                                                      |
| 界邓艾         | `ol_dengai`          | refresh  | 屯田 / 凿险                                                                                                                                      |
| 界祝融         | `ol_zhurong`         | refresh  | 巨象 / 烈刃 / 长标                                                                                                                               |
| 界姜维         | `ol_jiangwei`        | refresh  | 挑衅 / 志继                                                                                                                                      |
| 界贾诩         | `re_jiaxu`           | refresh  | 完杀 / 乱武 / 帷幕                                                                                                                               |
| 界荀彧         | `ol_xunyu`           | refresh  | 驱虎 / 节命                                                                                                                                      |
| 界典韦         | `ol_dianwei`         | refresh  | 强袭 / 狞恶                                                                                                                                      |
| 界颜良文丑     | `ol_yanwen`          | refresh  | 双雄                                                                                                                                             |
| 界张昭张纮     | `ol_zhangzhang`      | refresh  | 直谏 / 固政                                                                                                                                      |
| 界徐盛         | `re_xusheng`         | mobile   | 破军                                                                                                                                             |
| 界陈宫         | `re_chengong`        | refresh  | 明策 / 智迟                                                                                                                                      |
| 界法正         | `ol_fazheng`         | onlyOL   | 眩惑 / 恩怨                                                                                                                                      |
| 界王异         | `ol_wangyi`          | onlyOL   | 贞烈 / 秘计                                                                                                                                      |
| 界张春华       | `ol_zhangchunhua`    | onlyOL   | 绝情 / 伤逝 / 翦灭                                                                                                                               |
| 界曹冲         | `ol_caochong`        | onlyOL   | 称象 / 仁心                                                                                                                                      |
| 界郭淮         | `ol_guohuai`         | onlyOL   | 精策                                                                                                                                             |
| 界韩当         | `xin_handang`        | refresh  | 弓骑 / 解烦                                                                                                                                      |
| 界马岱         | `ol_madai`           | onlyOL   | 马术 / 潜袭                                                                                                                                      |
| 界沮授         | **缺项**             | —        | OL官方为3体力、开局3护甲及可转基本牌的渐营／矢北；re_jushou是无护甲、无主动转化的另一版，xin_jushou为2/3体力的手杀界版，不修改体力或借同名替代。 |
| 界夏侯氏       | `ol_xiahoushi`       | onlyOL   | 樵拾 / 燕语                                                                                                                                      |
| 界于禁         | `ol_re_yujin`        | onlyOL   | 镇军 / 毅重                                                                                                                                      |
| 界关平         | `ol_guanping`        | onlyOL   | 龙吟 / 竭勇                                                                                                                                      |
| 谋关羽         | `ol_sb_guanyu`       | onlyOL   | 威临 / 夺首                                                                                                                                      |
| 谋孙坚         | `ol_sb_sunjian`      | onlyOL   | 虎烈 / 毅魄                                                                                                                                      |
| 谋黄月英       | `ol_sb_huangyueying` | onlyOL   | 理贤 / 并才                                                                                                                                      |
| 谋小乔         | `ol_sb_xiaoqiao`     | onlyOL   | 迷落 / 绝颜                                                                                                                                      |
| 谋程昱         | `ol_sb_chengyu`      | onlyOL   | 戾断 / 胆持                                                                                                                                      |
| 谋祝融         | `ol_sb_zhurong`      | onlyOL   | 刃掣 / 牙镰                                                                                                                                      |
| 谋周瑜         | **缺项**             | —        | OL版为顾曲／醉锋；固定引擎仅有手杀英姿／反间和新杀融火／英谋，没有此OL原生版本。                                                                 |
| 神吕蒙         | `shen_lvmeng`        | extra    | 涉猎 / 攻心                                                                                                                                      |
| 神周瑜         | `shen_zhouyu`        | extra    | 业炎 / 琴音                                                                                                                                      |
| 神曹操         | `shen_caocao`        | extra    | 归心 / 飞影                                                                                                                                      |
| 神陆逊         | `shen_luxun`         | extra    | 军略 / 摧克 / 绽火                                                                                                                               |
| 族荀灌         | `clan_xunguan`       | clan     | 遁迹 / 云影 / 蹈节                                                                                                                               |
| 族陆郁生       | `clan_luyusheng`     | clan     | 拾昔 / 坚白 / 泽烈                                                                                                                               |
| SP孙尚香       | `sp_sunshangxiang`   | sp       | 良助 / 返乡                                                                                                                                      |
| SP马超         | `sp_machao`          | sp       | 追击 / 誓仇                                                                                                                                      |
| SP赵云         | `sp_zhaoyun`         | sp       | 龙胆 / 冲阵                                                                                                                                      |
| SP蔡文姬       | `sp_caiwenji`        | sp       | 陈情 / 默识                                                                                                                                      |
| SP姜维         | `sp_jiangwei`        | sp       | 困奋 / 逢亮                                                                                                                                      |
| SP张郃         | `sp_ol_zhanghe`      | sp       | 周旋                                                                                                                                             |
| SP黄月英       | `jsp_huangyueying`   | sp       | 机巧 / 玲珑                                                                                                                                      |
| SP孙策         | `sp_sunce`           | sp       | 连讨                                                                                                                                             |
| 张星彩         | `zhangxingcai`       | sp       | 甚贤 / 枪舞                                                                                                                                      |
| 丁奉           | `dingfeng`           | sp       | 短兵 / 奋迅                                                                                                                                      |
| 潘凤           | `re_panfeng`         | huicui   | 狂斧                                                                                                                                             |
| 何太后         | `hetaihou`           | sp       | 鸩毒 / 戚乱                                                                                                                                      |
| 王荣           | `ol_wangrong`        | sp       | 丰姿 / 吉占 / 赋颂                                                                                                                               |
| 董允           | `dongyun`            | sp       | 秉正 / 舍宴                                                                                                                                      |
| 麹义           | `quyi`               | sp       | 伏骑 / 骄恣                                                                                                                                      |
| 刘琦           | `sp_liuqi`           | sp2      | 问计 / 屯江                                                                                                                                      |
| 鲁芝           | `luzhi`              | sp       | 清忠 / 卫境                                                                                                                                      |
| 李傕           | `lijue`              | sp2      | 狼袭 / 亦算                                                                                                                                      |
| 沙摩柯         | `shamoke`            | sp       | 蒺藜                                                                                                                                             |
| 吕旷吕翔       | `lvkuanglvxiang`     | sp2      | 列侯 / 齐攻                                                                                                                                      |
| 伊籍           | `xf_yiji`            | standard | 机捷 / 急援                                                                                                                                      |
| 朱儁           | `ol_zhujun`          | sp       | 摧破                                                                                                                                             |
| 刘晔           | `ol_liuye`           | sp       | 平垣 / 料意                                                                                                                                      |
| 逄纪           | `pangji`             | sp       | 愎果 / 斗誉                                                                                                                                      |
| 刘璋           | `ol_liuzhang`        | sp       | 奉蔚 / 宗护                                                                                                                                      |
| 孙鸢           | `sunyuan`            | sp       | 飒影 / 恫心                                                                                                                                      |
| 崔琰           | `ol_cuiyan`          | sp       | 束统 / 直节                                                                                                                                      |
| 唐棠           | **缺项**             | —        | OL版为择行／知意；固定引擎角色及技能目录均未收录对应原生版本，不自行实现。                                                                       |
| 董予安         | `ol_dongguiren`      | sp       | 和煦 / 泽光 / 承恩                                                                                                                               |
| 谢灵毓         | **缺项**             | —        | OL当前元嫡按弃牌堆牌名组摸牌、心幽为弃基本牌连摸；原生xielingyu虽同技能名，机制为出牌首张互动与回满体力／手牌，不能同名替代。                    |
| 司马师         | `jin_simashi`        | yingbian | 韬隐 / 夷灭 / 睿略 / 泰然                                                                                                                        |
| 晋张春华       | `jin_zhangchunhua`   | yingbian | 慧识 / 清冷 / 宣穆                                                                                                                               |
| 周处           | `jin_zhouchu`        | sp       | 善断 / 义烈                                                                                                                                      |

- 许褚 → `xuzhu`：官方基础表中许褚重复列出两次，本档按官方名及原生ID去重，仅计一将；基础151将、进阶追加137将，完整288将。 [版本依据](https://www.sanguosha.com/hero/19)
- 标华雄 → `huaxiong`：公告使用标华雄区分版本，固定原生standard:huaxiong为耀武；不用带势斩的界华雄。 [版本依据](https://www.sanguosha.com/hero/214)
- 魏延 → `re_weiyan`：OL普通魏延已为狂骨／奇谋，选择完整re_weiyan；不用名称前缀判断普通／界版本。 [版本依据](https://www.sanguosha.com/hero/27)
- 庞德 → `re_pangde`：OL普通庞德鞬出按装备／非装备分支，使用re_pangde；界庞德ol_pangde按基本／非基本牌分支并增加杀次数，分别对应。 [版本依据](https://www.sanguosha.com/hero/39)
- 袁绍 → `re_yuanshao`：OL普通袁绍为同花色双手牌乱击／血裔，选择re_yuanshao。 [版本依据](https://www.sanguosha.com/hero/41)
- 张角 → `sp_zhangjiao`：OL普通张角为黑桃2雷、梅花回复并1雷的雷击，选择sp_zhangjiao；界版另用re_zhangjiao。 [版本依据](https://www.sanguosha.com/hero/212)
- 王基 → `wangji`：同平台原生历史文本差异：原生奇制明确选择不为该牌目标的角色，官网当前文字简写为另一名角色；保留固定原生完整规则。 [版本依据](https://www.sanguosha.com/hero/362)
- 陆抗 → `lukang`：同平台原生历史修订差异：固定决堰在当回合效果之外含整局增加杀次数／手牌上限／无距离等效果，并会修改决堰；官网当前页以本回合效果描述。本档完整保留固定原生，不改成官网文本。 [版本依据](https://www.sanguosha.com/hero/414)
- 张绣 → `zhangxiu`：雄乱／从谏与该平台版本相同；保留完整原生额外主公技踞襄及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.com/hero/415)
- 郭淮 → `guohuai`：同平台原生历史参数差异：官网精策摸牌数按本回合使用牌类型数描述，固定原生按本出牌阶段计算，保留原生文本及执行。 [版本依据](https://www.sanguosha.com/hero/175)
- 钟繇 → `zhongyao`：使用yijiang:zhongyao的OL活墨／佐定，不用mobile:mb_zhongyao。官网佐定条件写本阶段未伤害，固定原生写本回合，保留固定历史参数。 [版本依据](https://www.sanguosha.com/hero/334)
- 界黄忠 → `re_huangzhong`：OL界黄忠的烈弓对应原生黄忠（re_huangzhong）；原生OL黄忠（ol_huangzhong）另有非主公技没矢，不采用该候选。 [版本依据](https://www.sanguosha.com/hero/26)
- 界孙尚香 → `re_sunshangxiang`：同平台原生历史参数差异：固定结姻装备分支使用装备区内的一张牌，官网当前文字为将一张装备牌置入目标装备区，保留原生合法材料范围。 [版本依据](https://www.sanguosha.com/hero/443)
- 界孙坚 → `ol_sunjian`：英魂／武烈与OL界孙坚相同；保留完整原生额外主公技破虏及主公标记。 [版本依据](https://www.sanguosha.com/hero/458)
- 界徐盛 → `re_xusheng`：复核OL官方页的完整破军文本，含手牌数和装备数均不多于本人时伤害+1；固定原生repojun/repojun2/repojun3与此规则对应。原生显示名虽为手杀界徐盛，其规则与当前OL版相同，不采用带额外弃装备／摸牌的xin_xusheng。 [版本依据](https://www.sanguosha.com/hero/587)
- 界郭淮 → `ol_guohuai`：选择onlyOL:ol_guohuai，精策在每个出牌阶段结束时可触发；官网按本回合牌类型数，固定原生按本阶段类型数，保留同平台历史参数。 [版本依据](https://www.sanguosha.com/hero/658)
- 界关平 → `ol_guanping`：当前官网英雄目录尚未提供独立界关平页；按官方排位公告列名及固定onlyOL:ol_guanping的OL界标识、龙吟／竭勇审查，拒绝refresh:re_guanping的龙吟／竭忠。
- SP赵云 → `sp_zhaoyun`：同平台原生龙胆历史修订差异：官网仅列杀／闪互转；固定ollongdan同时支持桃／酒互转，冲阵仍只在龙胆杀／闪时夺取手牌，完整保留原生规则。 [版本依据](https://www.sanguosha.com/hero/108)
- 潘凤 → `re_panfeng`：OL狂斧为主动弃装备视为出杀版本，选择huicui:re_panfeng；不用standard:std_panfeng的旧狂斧。 [版本依据](https://www.sanguosha.com/hero/127)
- 刘琦 → `sp_liuqi`：同平台原生历史修订差异：官网问计为同牌名不能被响应，固定sp_liuqi为同类型；固定屯江亦保留原生判定条件，不改技能。 [版本依据](https://www.sanguosha.com/hero/378)
- 吕旷吕翔 → `lvkuanglvxiang`：OL为列侯／齐攻，使用sp:lvkuanglvxiang，不用dc_lvkuanglvxiang的数合／列侯。 [版本依据](https://www.sanguosha.com/hero/434)
- 逄纪 → `pangji`：官方排位表写逄纪，OL英雄页/679和原生sp:pangji写逢纪；核对均为愎果／斗誉，作为同角色异体写法收录。 [版本依据](https://www.sanguosha.com/hero/679)
- 刘璋 → `ol_liuzhang`：OL英雄页标题技能写丰蔚，原生写奉蔚，完整机制均为轮初摸牌留标与宗护，选ol_liuzhang，不用据土／邀虎／怀璧版。 [版本依据](https://www.sanguosha.com/hero/683)
- 董予安 → `ol_dongguiren`：原生ID仍为ol_dongguiren，显示名为董予安；以和煦／泽光／承恩三技能核对，不选新杀／其他平台董贵人。 [版本依据](https://www.sanguosha.com/hero/755)
- 司马师 → `jin_simashi`：OL公告的司马师对应晋势力隐匿版jin_simashi，完整保留韬隐／夷灭／睿略／泰然、主公标记及隐匿，不用败移／景略／擅立版simashi。 [版本依据](https://www.sanguosha.com/hero/7002)
- 界沮授：[平台技能依据](https://www.sanguosha.com/hero/749)；排除 `re_jushou`、`xin_jushou`。
- 谋周瑜：[平台技能依据](https://www.sanguosha.com/hero/770)；排除 `sb_zhouyu`、`dc_sb_zhouyu`。
- 唐棠：[平台技能依据](https://www.sanguosha.com/hero/744)；固定引擎无同名原生候选。
- 谢灵毓：[平台技能依据](https://www.sanguosha.com/hero/769)；排除 `xielingyu`。

## OL排位完整池（2026年10月）

[官方公告](https://www.sanguosha.com/news/20260922_1251_1414)；发布于 2026-09-30。对应原活动2v2，本项目可用于现有四模式。

合并官方基础151将与大将及以上开启的进阶追加137将，共288将；基础表许褚重复一格仅计一次。

| 公告／目录武将 | 原生ID               | 定义包   | 原生技能 / 缺项原因                                                                                                                              |
| -------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 刘备           | `liubei`             | standard | 仁德 / 激将                                                                                                                                      |
| 关羽           | `guanyu`             | standard | 武圣                                                                                                                                             |
| 张飞           | `zhangfei`           | standard | 咆哮                                                                                                                                             |
| 诸葛亮         | `zhugeliang`         | standard | 观星 / 空城                                                                                                                                      |
| 赵云           | `zhaoyun`            | standard | 龙胆                                                                                                                                             |
| 马超           | `machao`             | standard | 马术 / 铁骑                                                                                                                                      |
| 黄月英         | `huangyueying`       | standard | 集智 / 奇才                                                                                                                                      |
| 孙权           | `sunquan`            | standard | 制衡 / 救援                                                                                                                                      |
| 甘宁           | `ganning`            | standard | 奇袭                                                                                                                                             |
| 吕蒙           | `lvmeng`             | standard | 克己                                                                                                                                             |
| 黄盖           | `huanggai`           | standard | 苦肉                                                                                                                                             |
| 周瑜           | `zhouyu`             | standard | 英姿 / 反间                                                                                                                                      |
| 陆逊           | `luxun`              | standard | 谦逊 / 连营                                                                                                                                      |
| 曹操           | `caocao`             | standard | 奸雄 / 护驾                                                                                                                                      |
| 司马懿         | `simayi`             | standard | 反馈 / 鬼才                                                                                                                                      |
| 夏侯惇         | `xiahoudun`          | standard | 刚烈                                                                                                                                             |
| 张辽           | `zhangliao`          | standard | 突袭                                                                                                                                             |
| 许褚           | `xuzhu`              | standard | 裸衣                                                                                                                                             |
| 郭嘉           | `guojia`             | standard | 天妒 / 遗计                                                                                                                                      |
| 甄姬           | `zhenji`             | standard | 洛神 / 倾国                                                                                                                                      |
| 吕布           | `lvbu`               | standard | 无双                                                                                                                                             |
| 貂蝉           | `diaochan`           | standard | 离间 / 闭月                                                                                                                                      |
| 孙尚香         | `sunshangxiang`      | standard | 枭姬 / 结姻                                                                                                                                      |
| 标华雄         | `huaxiong`           | standard | 耀武                                                                                                                                             |
| 魏延           | `re_weiyan`          | shenhua  | 狂骨 / 奇谋                                                                                                                                      |
| 小乔           | `xiaoqiao`           | shenhua  | 天香 / 红颜                                                                                                                                      |
| 典韦           | `dianwei`            | shenhua  | 强袭                                                                                                                                             |
| 荀彧           | `xunyu`              | shenhua  | 驱虎 / 节命                                                                                                                                      |
| 庞德           | `re_pangde`          | shenhua  | 马术 / 鞬出                                                                                                                                      |
| 袁绍           | `re_yuanshao`        | shenhua  | 乱击 / 血裔                                                                                                                                      |
| 刘禅           | `liushan`            | shenhua  | 享乐 / 放权 / 若愚                                                                                                                               |
| 孙策           | `sunce`              | shenhua  | 激昂 / 魂姿 / 制霸                                                                                                                               |
| 张角           | `sp_zhangjiao`       | shenhua  | 雷击 / 鬼道 / 黄天                                                                                                                               |
| 王基           | `wangji`             | shenhua  | 奇制 / 进趋                                                                                                                                      |
| 王平           | `wangping`           | shenhua  | 飞军 / 兵略                                                                                                                                      |
| 郝昭           | `haozhao`            | shenhua  | 镇骨                                                                                                                                             |
| 诸葛瞻         | `zhugezhan`          | shenhua  | 罪论 / 父荫                                                                                                                                      |
| 陆抗           | `lukang`             | shenhua  | 谦节 / 决堰 / 破势                                                                                                                               |
| 张绣           | `zhangxiu`           | shenhua  | 雄乱 / 从谏 / 踞襄                                                                                                                               |
| 陈宫           | `chengong`           | yijiang  | 明策 / 智迟                                                                                                                                      |
| 张春华         | `zhangchunhua`       | yijiang  | 绝情 / 伤逝                                                                                                                                      |
| 荀攸           | `xunyou`             | yijiang  | 奇策 / 智愚                                                                                                                                      |
| 郭淮           | `guohuai`            | yijiang  | 精策                                                                                                                                             |
| 刘封           | `liufeng`            | yijiang  | 陷嗣                                                                                                                                             |
| 法正           | `xin_fazheng`        | yijiang  | 眩惑 / 恩怨                                                                                                                                      |
| 关兴张苞       | `guanzhang`          | yijiang  | 父魂                                                                                                                                             |
| 陈群           | `chenqun`            | yijiang  | 品第 / 法恩                                                                                                                                      |
| 周仓           | `zhoucang`           | yijiang  | 忠勇                                                                                                                                             |
| 张松           | `zhangsong`          | yijiang  | 强识 / 献图                                                                                                                                      |
| 朱桓           | `zhuhuan`            | yijiang  | 奋励 / 平寇                                                                                                                                      |
| 沮授           | `yj_jushou`          | yijiang  | 渐营 / 矢北                                                                                                                                      |
| 钟繇           | `zhongyao`           | yijiang  | 活墨 / 佐定                                                                                                                                      |
| 夏侯氏         | `xiahoushi`          | yijiang  | 樵拾 / 燕语                                                                                                                                      |
| 嵇康           | `jikang`             | yijiang  | 清弦 / 绝响                                                                                                                                      |
| 秦宓           | `qinmi`              | yijiang  | 谏征 / 专对 / 天辩                                                                                                                               |
| 界黄忠         | `re_huangzhong`      | shenhua  | 烈弓                                                                                                                                             |
| 界刘备         | `re_liubei`          | refresh  | 仁德 / 激将                                                                                                                                      |
| 界关羽         | `re_guanyu`          | refresh  | 武圣 / 义绝                                                                                                                                      |
| 界张飞         | `re_zhangfei`        | refresh  | 咆哮 / 替身                                                                                                                                      |
| 界赵云         | `re_zhaoyun`         | refresh  | 龙胆 / 涯角                                                                                                                                      |
| 界马超         | `re_machao`          | refresh  | 马术 / 铁骑                                                                                                                                      |
| 界甘宁         | `re_ganning`         | refresh  | 奇袭 / 奋威                                                                                                                                      |
| 界黄盖         | `re_huanggai`        | refresh  | 苦肉 / 诈降                                                                                                                                      |
| 界周瑜         | `re_zhouyu`          | refresh  | 英姿 / 反间                                                                                                                                      |
| 界陆逊         | `re_luxun`           | refresh  | 谦逊 / 连营                                                                                                                                      |
| 界曹操         | `re_caocao`          | refresh  | 奸雄 / 护驾                                                                                                                                      |
| 界张辽         | `re_zhangliao`       | refresh  | 突袭                                                                                                                                             |
| 界许褚         | `re_xuzhu`           | refresh  | 裸衣                                                                                                                                             |
| 界郭嘉         | `re_guojia`          | refresh  | 天妒 / 遗计                                                                                                                                      |
| 界李典         | `re_lidian`          | refresh  | 恂恂 / 忘隙                                                                                                                                      |
| 界吕布         | `re_lvbu`            | refresh  | 无双 / 利驭                                                                                                                                      |
| 界诸葛亮       | `re_zhugeliang`      | refresh  | 观星 / 空城                                                                                                                                      |
| 界黄月英       | `re_huangyueying`    | refresh  | 集智 / 奇才                                                                                                                                      |
| 界孙权         | `re_sunquan`         | refresh  | 制衡 / 救援                                                                                                                                      |
| 界孙尚香       | `re_sunshangxiang`   | refresh  | 枭姬 / 结姻                                                                                                                                      |
| 界甄姬         | `re_zhenji`          | refresh  | 洛神 / 倾国                                                                                                                                      |
| 界貂蝉         | `re_diaochan`        | refresh  | 离间 / 闭月                                                                                                                                      |
| 界华雄         | `re_huaxiong`        | refresh  | 耀武 / 势斩                                                                                                                                      |
| 界张角         | `re_zhangjiao`       | refresh  | 雷击 / 鬼道 / 黄天                                                                                                                               |
| 界刘禅         | `ol_liushan`         | refresh  | 享乐 / 放权 / 若愚                                                                                                                               |
| 界孙策         | `re_sunce`           | refresh  | 激昂 / 魂姿 / 制霸                                                                                                                               |
| 界孙坚         | `ol_sunjian`         | refresh  | 英魂 / 武烈 / 破虏                                                                                                                               |
| 界庞德         | `ol_pangde`          | refresh  | 马术 / 鞬出                                                                                                                                      |
| 界太史慈       | `re_taishici`        | refresh  | 天义 / 酣战                                                                                                                                      |
| 界邓艾         | `ol_dengai`          | refresh  | 屯田 / 凿险                                                                                                                                      |
| 界祝融         | `ol_zhurong`         | refresh  | 巨象 / 烈刃 / 长标                                                                                                                               |
| 界姜维         | `ol_jiangwei`        | refresh  | 挑衅 / 志继                                                                                                                                      |
| 界贾诩         | `re_jiaxu`           | refresh  | 完杀 / 乱武 / 帷幕                                                                                                                               |
| 界荀彧         | `ol_xunyu`           | refresh  | 驱虎 / 节命                                                                                                                                      |
| 界典韦         | `ol_dianwei`         | refresh  | 强袭 / 狞恶                                                                                                                                      |
| 界颜良文丑     | `ol_yanwen`          | refresh  | 双雄                                                                                                                                             |
| 界张昭张纮     | `ol_zhangzhang`      | refresh  | 直谏 / 固政                                                                                                                                      |
| 界徐盛         | `re_xusheng`         | mobile   | 破军                                                                                                                                             |
| 界陈宫         | `re_chengong`        | refresh  | 明策 / 智迟                                                                                                                                      |
| 界法正         | `ol_fazheng`         | onlyOL   | 眩惑 / 恩怨                                                                                                                                      |
| 界王异         | `ol_wangyi`          | onlyOL   | 贞烈 / 秘计                                                                                                                                      |
| 界张春华       | `ol_zhangchunhua`    | onlyOL   | 绝情 / 伤逝 / 翦灭                                                                                                                               |
| 界曹冲         | `ol_caochong`        | onlyOL   | 称象 / 仁心                                                                                                                                      |
| 界郭淮         | `ol_guohuai`         | onlyOL   | 精策                                                                                                                                             |
| 界韩当         | `xin_handang`        | refresh  | 弓骑 / 解烦                                                                                                                                      |
| 界马岱         | `ol_madai`           | onlyOL   | 马术 / 潜袭                                                                                                                                      |
| 界沮授         | **缺项**             | —        | OL官方为3体力、开局3护甲及可转基本牌的渐营／矢北；re_jushou是无护甲、无主动转化的另一版，xin_jushou为2/3体力的手杀界版，不修改体力或借同名替代。 |
| 界夏侯氏       | `ol_xiahoushi`       | onlyOL   | 樵拾 / 燕语                                                                                                                                      |
| 界于禁         | `ol_re_yujin`        | onlyOL   | 镇军 / 毅重                                                                                                                                      |
| 界关平         | `ol_guanping`        | onlyOL   | 龙吟 / 竭勇                                                                                                                                      |
| 谋关羽         | `ol_sb_guanyu`       | onlyOL   | 威临 / 夺首                                                                                                                                      |
| 谋孙坚         | `ol_sb_sunjian`      | onlyOL   | 虎烈 / 毅魄                                                                                                                                      |
| 谋黄月英       | `ol_sb_huangyueying` | onlyOL   | 理贤 / 并才                                                                                                                                      |
| 谋小乔         | `ol_sb_xiaoqiao`     | onlyOL   | 迷落 / 绝颜                                                                                                                                      |
| 谋程昱         | `ol_sb_chengyu`      | onlyOL   | 戾断 / 胆持                                                                                                                                      |
| 谋祝融         | `ol_sb_zhurong`      | onlyOL   | 刃掣 / 牙镰                                                                                                                                      |
| 谋周瑜         | **缺项**             | —        | OL版为顾曲／醉锋；固定引擎仅有手杀英姿／反间和新杀融火／英谋，没有此OL原生版本。                                                                 |
| 神吕蒙         | `shen_lvmeng`        | extra    | 涉猎 / 攻心                                                                                                                                      |
| 神周瑜         | `shen_zhouyu`        | extra    | 业炎 / 琴音                                                                                                                                      |
| 神曹操         | `shen_caocao`        | extra    | 归心 / 飞影                                                                                                                                      |
| 神陆逊         | `shen_luxun`         | extra    | 军略 / 摧克 / 绽火                                                                                                                               |
| 族荀灌         | `clan_xunguan`       | clan     | 遁迹 / 云影 / 蹈节                                                                                                                               |
| 族陆郁生       | `clan_luyusheng`     | clan     | 拾昔 / 坚白 / 泽烈                                                                                                                               |
| SP孙尚香       | `sp_sunshangxiang`   | sp       | 良助 / 返乡                                                                                                                                      |
| SP马超         | `sp_machao`          | sp       | 追击 / 誓仇                                                                                                                                      |
| SP赵云         | `sp_zhaoyun`         | sp       | 龙胆 / 冲阵                                                                                                                                      |
| SP蔡文姬       | `sp_caiwenji`        | sp       | 陈情 / 默识                                                                                                                                      |
| SP姜维         | `sp_jiangwei`        | sp       | 困奋 / 逢亮                                                                                                                                      |
| SP张郃         | `sp_ol_zhanghe`      | sp       | 周旋                                                                                                                                             |
| SP黄月英       | `jsp_huangyueying`   | sp       | 机巧 / 玲珑                                                                                                                                      |
| SP孙策         | `sp_sunce`           | sp       | 连讨                                                                                                                                             |
| 张星彩         | `zhangxingcai`       | sp       | 甚贤 / 枪舞                                                                                                                                      |
| 丁奉           | `dingfeng`           | sp       | 短兵 / 奋迅                                                                                                                                      |
| 潘凤           | `re_panfeng`         | huicui   | 狂斧                                                                                                                                             |
| 何太后         | `hetaihou`           | sp       | 鸩毒 / 戚乱                                                                                                                                      |
| 王荣           | `ol_wangrong`        | sp       | 丰姿 / 吉占 / 赋颂                                                                                                                               |
| 董允           | `dongyun`            | sp       | 秉正 / 舍宴                                                                                                                                      |
| 麹义           | `quyi`               | sp       | 伏骑 / 骄恣                                                                                                                                      |
| 刘琦           | `sp_liuqi`           | sp2      | 问计 / 屯江                                                                                                                                      |
| 鲁芝           | `luzhi`              | sp       | 清忠 / 卫境                                                                                                                                      |
| 李傕           | `lijue`              | sp2      | 狼袭 / 亦算                                                                                                                                      |
| 沙摩柯         | `shamoke`            | sp       | 蒺藜                                                                                                                                             |
| 吕旷吕翔       | `lvkuanglvxiang`     | sp2      | 列侯 / 齐攻                                                                                                                                      |
| 伊籍           | `xf_yiji`            | standard | 机捷 / 急援                                                                                                                                      |
| 朱儁           | `ol_zhujun`          | sp       | 摧破                                                                                                                                             |
| 刘晔           | `ol_liuye`           | sp       | 平垣 / 料意                                                                                                                                      |
| 逄纪           | `pangji`             | sp       | 愎果 / 斗誉                                                                                                                                      |
| 刘璋           | `ol_liuzhang`        | sp       | 奉蔚 / 宗护                                                                                                                                      |
| 孙鸢           | `sunyuan`            | sp       | 飒影 / 恫心                                                                                                                                      |
| 崔琰           | `ol_cuiyan`          | sp       | 束统 / 直节                                                                                                                                      |
| 唐棠           | **缺项**             | —        | OL版为择行／知意；固定引擎角色及技能目录均未收录对应原生版本，不自行实现。                                                                       |
| 董予安         | `ol_dongguiren`      | sp       | 和煦 / 泽光 / 承恩                                                                                                                               |
| 谢灵毓         | **缺项**             | —        | OL当前元嫡按弃牌堆牌名组摸牌、心幽为弃基本牌连摸；原生xielingyu虽同技能名，机制为出牌首张互动与回满体力／手牌，不能同名替代。                    |
| 司马师         | `jin_simashi`        | yingbian | 韬隐 / 夷灭 / 睿略 / 泰然                                                                                                                        |
| 晋张春华       | `jin_zhangchunhua`   | yingbian | 慧识 / 清冷 / 宣穆                                                                                                                               |
| 周处           | `jin_zhouchu`        | sp       | 善断 / 义烈                                                                                                                                      |
| 陆绩           | `luji`               | shenhua  | 怀橘 / 遗礼 / 整论                                                                                                                               |
| 许攸           | `xuyou`              | shenhua  | 成略 / 恃才 / 寸目                                                                                                                               |
| 周妃           | `zhoufei`            | shenhua  | 良姻 / 箜声                                                                                                                                      |
| 吴懿           | `wuyi`               | yijiang  | 奔袭                                                                                                                                             |
| 界左慈         | `re_zuoci`           | refresh  | 化身 / 新生                                                                                                                                      |
| 界于吉         | `xin_yuji`           | refresh  | 蛊惑                                                                                                                                             |
| 界董卓         | `ol_dongzhuo`        | refresh  | 酒池 / 肉林 / 崩坏 / 暴虐                                                                                                                        |
| 界鲁肃         | `ol_lusu`            | refresh  | 好施 / 缔盟                                                                                                                                      |
| 界简雍         | `ol_jianyong`        | onlyOL   | 巧说 / 纵适                                                                                                                                      |
| 界虞翻         | `ol_yufan`           | onlyOL   | 纵玄 / 直言                                                                                                                                      |
| 界程普         | `ol_chengpu`         | onlyOL   | 疠火 / 醇醪                                                                                                                                      |
| 界廖化         | `ol_liaohua`         | onlyOL   | 当先 / 伏枥                                                                                                                                      |
| 界关兴张苞     | `ol_guanzhang`       | onlyOL   | 父魂                                                                                                                                             |
| 界郭皇后       | `ol_guohuanghou`     | onlyOL   | 矫诏 / 殚心                                                                                                                                      |
| 界张松         | `ol_zhangsong`       | onlyOL   | 强识 / 献图                                                                                                                                      |
| 界步练师       | `ol_bulianshi`       | onlyOL   | 安恤 / 追忆                                                                                                                                      |
| 谋姜维         | `ol_sb_jiangwei`     | onlyOL   | 逐日 / 燃己                                                                                                                                      |
| 谋邓艾         | `ol_sb_dengai`       | onlyOL   | 积谷 / 解腕                                                                                                                                      |
| 谋太史慈       | `ol_sb_taishici`     | onlyOL   | 笃烈 / 斗缠                                                                                                                                      |
| 谋董卓         | `ol_sb_dongzhuo`     | onlyOL   | 观变 / 凶逆 / 封赏 / 执柄                                                                                                                        |
| 谋孔融         | `ol_sb_kongrong`     | onlyOL   | 立文 / 争义                                                                                                                                      |
| 谋华雄         | `ol_sb_huaxiong`     | onlyOL   | 搏决 / 扬威                                                                                                                                      |
| 谋袁术         | `ol_sb_yuanshu`      | onlyOL   | 矜名 / 枭噬 / 厌粱                                                                                                                               |
| 谋公孙瓒       | `ol_sb_gongsunzan`   | onlyOL   | 剿狄 / 保京                                                                                                                                      |
| 谋贾诩         | `ol_sb_jiaxu`        | onlyOL   | 完策 / 沉智 / 乱朝                                                                                                                               |
| 谋文丑         | `ol_sb_wenchou`      | onlyOL   | 轮战 / 决绝                                                                                                                                      |
| 谋卢植         | `ol_sb_yl_luzhi`     | onlyOL   | 司兵 / 敛策                                                                                                                                      |
| 谋诸葛亮       | `ol_sb_zhugeliang`   | onlyOL   | 知天 / 武靖 / 智绝                                                                                                                               |
| 谋戏志才       | `ol_sb_xizhicai`     | onlyOL   | 薪传 / 金烬                                                                                                                                      |
| 谋董昭         | `ol_sb_dongzhao`     | onlyOL   | 顺机 / 移势                                                                                                                                      |
| 神司马懿       | `shen_simayi`        | extra    | 忍戒 / 拜印 / 连破                                                                                                                               |
| 神甘宁         | `shen_ganning`       | extra    | 魄袭 / 劫营                                                                                                                                      |
| 神孙权         | `shen_sunquan`       | onlyOL   | 驭衡 / 帝力                                                                                                                                      |
| 神张角         | `junk_zhangjiao`     | onlyOL   | 异兆 / 肆军 / 天劫                                                                                                                               |
| 神典韦         | `shen_dianwei`       | onlyOL   | 捐甲 / 挈挟 / 摧决                                                                                                                               |
| 神黄忠         | `ol_shen_huangzhong` | onlyOL   | 神御 / 化刃                                                                                                                                      |
| 魔司马懿       | `dm_simayi`          | onlyOL   | 诡伏 / 谋变                                                                                                                                      |
| 魔貂蝉         | `dm_diaochan`        | onlyOL   | 幻惑 / 倾世                                                                                                                                      |
| 族荀谌         | `clan_xunchen`       | clan     | 三恇 / 卑势 / 蹈节                                                                                                                               |
| 族荀采         | `clan_xuncai`        | clan     | 烈誓 / 点盏 / 还阴 / 蹈节                                                                                                                        |
| 族吴苋         | `clan_wuxian`        | clan     | 移荣 / 贵相 / 穆荫                                                                                                                               |
| 族王凌         | `clan_wangling`      | clan     | 驳龙 / 中流                                                                                                                                      |
| 族钟会         | `clan_zhonghui`      | clan     | 迂志 / 挟术 / 保族                                                                                                                               |
| 族荀攸         | `clan_xunyou`        | clan     | 百出 / 蹈节                                                                                                                                      |
| 族王明山       | `clan_wangmingshan`  | clan     | 弹雀 / 剩墨 / 中流                                                                                                                               |
| 族钟繇         | `clan_zhongyao`      | clan     | 承启 / 诫厉 / 保族                                                                                                                               |
| 族王沈         | `clan_wangshen`      | clan     | 岸然 / 告变 / 中流                                                                                                                               |
| 族杨修         | `clan_yangxiu`       | clan     | 捷悟 / 高视 / 去惑                                                                                                                               |
| 族杨彪         | `clan_yangbiao`      | clan     | 间难 / 义叱 / 去惑                                                                                                                               |
| 族杨众         | `clan_yangzhong`     | clan     | 绝途 / 苦渡 / 去惑                                                                                                                               |
| 族陆绩         | `clan_luji`          | clan     | 该览 / 奋驽 / 泽烈                                                                                                                               |
| 族陆景         | `clan_lujing`        | clan     | 探锋 / 绝围 / 泽烈                                                                                                                               |
| 族陈群         | `clan_chenqun`       | clan     | 革制 / 明典 / 士则                                                                                                                               |
| 族荀莳         | `clan_xunshi`        | clan     | 清绝 / 萦香 / 蹈节                                                                                                                               |
| 闪赵云         | `ol_jsrg_zhaoyun`    | onlyOL   | 龙临 / 镇胆                                                                                                                                      |
| 闪刘宏         | `ol_jsrg_liuhong`    | onlyOL   | 朝争 / 甚宠 / 聚敛                                                                                                                               |
| 闪朱儁         | `ol_jsrg_zhujun`     | onlyOL   | 分敌 / 拒降                                                                                                                                      |
| 闪张辽         | `ol_jsrg_zhangliao`  | onlyOL   | 整兵 / 突围                                                                                                                                      |
| 蒲元           | `ol_puyuan`          | sp       | 神工 / 奇思                                                                                                                                      |
| 周群           | `ol_zhouqun`         | sp       | 天候 / 谶说                                                                                                                                      |
| 裴秀           | `ol_peixiu`          | sp       | 茂著 / 尽览 / 采风                                                                                                                               |
| SP曹操         | `sp_ol_caocao`       | sp       | 西向 / 哀歌                                                                                                                                      |
| SP刘备         | `sp_ol_liubei`       | sp       | 虚待 / 煮酒 / 惊雷                                                                                                                               |
| 祢衡           | `ol_miheng`          | sp       | 狂狷 / 飞辩                                                                                                                                      |
| 诸葛恪         | `zhugeke`            | sp       | 傲才 / 黩武                                                                                                                                      |
| 卑弥呼         | `beimihu`            | sp2      | 纵傀 / 骨疽 / 拜假                                                                                                                               |
| 丁原           | `ol_dingyuan`        | sp2      | 慈孝 / 先率                                                                                                                                      |
| 蒋干           | `jianggan`           | sp       | 伪诚 / 盗书                                                                                                                                      |
| 黄祖           | `huangzu`            | sp       | 挽弓                                                                                                                                             |
| 刘辩           | `liubian`            | xianding | 诗怨 / 毒逝 / 余威                                                                                                                               |
| 杨仪           | `ol_yangyi`          | sp       | 狷狭 / 定措                                                                                                                                      |
| 陈登           | `ol_chendeng`        | sp       | 丰积 / 旋回                                                                                                                                      |
| 清河公主       | `qinghegongzhu`      | sp       | 谮构 / 长姬                                                                                                                                      |
| 杨婉           | `yangwan`            | xianding | 诱言 / 追还                                                                                                                                      |
| 滕芳兰         | `tengfanglan`        | sp       | 落宠 / 哀尘                                                                                                                                      |
| 芮姬           | `ruiji`              | sp       | 巧力 / 清靓                                                                                                                                      |
| 霍峻           | `huojun`             | sp       | 穷守 / 奋锐                                                                                                                                      |
| 张芝           | `zhangzhi`           | sp       | 笔心 / 洗墨                                                                                                                                      |
| 文鸯           | `wenyang`            | xianding | 膂力 / 仇决                                                                                                                                      |
| 夏侯玄         | `xiahouxuan`         | sp       | 宦浮 / 清议 / 迮阅                                                                                                                               |
| 阎柔           | `yanrou`             | sp2      | 仇讨 / 襄戍                                                                                                                                      |
| 马承           | `macheng`            | sp       | 马术 / 骋烈                                                                                                                                      |
| 马休&马铁      | `maxiumatie`         | sp       | 马术 / 垦伤                                                                                                                                      |
| 张翼           | `ol_zhangyì`         | sp       | 殿军 / 亢锐                                                                                                                                      |
| 张华           | `zhanghua`           | sp       | 弼昏 / 剑合 / 穿屋                                                                                                                               |
| 成济成倅       | `chengjichengcui`    | yingbian | 透髓 / 畜鸣                                                                                                                                      |
| 孟达           | `ol_mengda`          | sp       | 苟得                                                                                                                                             |
| 陆郁生         | `ol_luyusheng`       | sp       | 藏心 / 润微                                                                                                                                      |
| 丁尚涴         | `ol_dingshangwan`    | sp       | 抚悼 / 讽言                                                                                                                                      |
| 彭羕           | `ol_pengyang`        | sp       | 嚣翻 / 侻失 / 寸目                                                                                                                               |
| 李婉           | `ol_liwan`           | sp       | 联句 / 思闾                                                                                                                                      |
| 吕伯奢         | `lvboshe`            | sp       | 缚豕 / 东道                                                                                                                                      |
| 田畴           | `tianchou`           | sp       | 善刀                                                                                                                                             |
| 刘辟           | `ol_liupi`           | sp       | 易城                                                                                                                                             |
| 曹腾           | `caoteng`            | sp       | 拥族 / 清流                                                                                                                                      |
| 郭图           | `guotu`              | sp       | 趋势 / 诿解                                                                                                                                      |
| 蔡瑁           | `caimao`             | sp       | 佐练 / 精舟                                                                                                                                      |
| 孙茹           | `ol_sunru`           | sp       | 持室 / 慰勉                                                                                                                                      |
| 刘焉           | `liuyan`             | sp       | 图射 / 立牧                                                                                                                                      |
| 轲比能         | `ol_kebineng`        | sp       | 平端                                                                                                                                             |
| 陶谦           | `ol_taoqian`         | sp       | 纵乱 / 温仁 / 招祸                                                                                                                               |
| 武安国         | `ol_wuanguo`         | sp       | 历勇                                                                                                                                             |
| 韩馥           | `ol_hanfu`           | sp       | 束辎 / 恇守                                                                                                                                      |
| 袁姬           | `ol_yuanji`          | sp       | 节言 / 镜花 / 水月                                                                                                                               |
| 孔淑           | `kongshu`            | sp       | 累卵 / 覆巢                                                                                                                                      |
| 牛辅           | `ol_niufu`           | sp       | 蓍算 / 纵掠                                                                                                                                      |
| 董翓           | `ol_dongxie`         | sp       | 狡威 / 鞭御 / 凤瑶                                                                                                                               |
| 袁涣           | `ol_yuanhuan`        | sp       | 德辱 / 临节                                                                                                                                      |
| 吴景           | `ol_wujing`          | sp       | 合击 / 流兵                                                                                                                                      |
| 李丰           | `ol_lifeng`          | sp       | 集运 / 输粮                                                                                                                                      |
| 张曼成         | `ol_zhangmancheng`   | sp       | 狂信 / 雷噬                                                                                                                                      |
| 管亥           | `ol_guanhai`         | sp       | 卸尾 / 诱阙                                                                                                                                      |
| 赵忠           | `ol_zhaozhong`       | sp       | 朋比 / 抵慈                                                                                                                                      |
| 阮瑀           | `ruanyu`             | xianding | 兴作 / 妙弦                                                                                                                                      |
| 环淑君         | `huanshujun`         | sp       | 环佩 / 温宜 / 妙心                                                                                                                               |
| 段煨           | `ol_duanwei`         | sp       | 讨怀                                                                                                                                             |
| 宣公主         | `xuangongzhu`        | yingbian | 高陵 / 齐眉 / 追姬                                                                                                                               |
| 夏侯徽         | `jin_xiahouhui`      | yingbian | 宝箧 / 宜室 / 识度                                                                                                                               |
| 晋司马懿       | `jin_simayi`         | yingbian | 不臣 / 鹰视 / 雄志 / 权变                                                                                                                        |
| 司马昭         | `jin_simazhao`       | yingbian | 推弑 / 筹伐 / 昭然 / 成务                                                                                                                        |
| 王元姬         | `jin_wangyuanji`     | yingbian | 识人 / 宴戏                                                                                                                                      |
| 卫瓘           | `weiguan`            | yingbian | 忠允 / 神品                                                                                                                                      |
| 钟琰           | `zhongyan`           | yingbian | 博览 / 仪法                                                                                                                                      |
| 杨芷           | `yangzhi`            | yingbian | 婉嫕 / 埋祸                                                                                                                                      |
| 贾充           | `jin_jiachong`       | yingbian | 凶竖 / 奸回                                                                                                                                      |
| 曹婴           | `caoying`            | sp       | 凌人 / 伏间                                                                                                                                      |
| 张琪瑛         | `zhangqiying`        | sp       | 法箓 / 点化 / 真仪                                                                                                                               |
| 曹纯           | `caochun`            | sp       | 缮甲                                                                                                                                             |
| 袁谭&袁尚      | `yuantanyuanshang`   | sp       | 内伐                                                                                                                                             |
| 卧龙凤雏       | `wolongfengchu`      | sp       | 游龙 / 鸾凤                                                                                                                                      |
| 潘淑           | `panshu`             | sp       | 威仪 / 锦织                                                                                                                                      |
| 冯方女         | `fengfangnv`         | sp       | 妆梳 / 垂涕                                                                                                                                      |
| 蒋琬           | `ol_jiangwan`        | sp       | 自若 / 蓄发                                                                                                                                      |
| 郭照           | `ol_guozhao`         | sp       | 椒遇 / 内训                                                                                                                                      |
| 吕玲绮         | `ol_lvlingqi`        | sp       | 绮武 / 妆戎                                                                                                                                      |
| 曹金玉         | `ol_caojinyu`        | sp       | 春晖 / 夏晟 / 秋暮                                                                                                                               |
| 王朗           | `ol_wanglang`        | sp       | 鼓舌 / 激词                                                                                                                                      |

- 许褚 → `xuzhu`：官方基础表中许褚重复列出两次，本档按官方名及原生ID去重，仅计一将；基础151将、进阶追加137将，完整288将。 [版本依据](https://www.sanguosha.com/hero/19)
- 标华雄 → `huaxiong`：公告使用标华雄区分版本，固定原生standard:huaxiong为耀武；不用带势斩的界华雄。 [版本依据](https://www.sanguosha.com/hero/214)
- 魏延 → `re_weiyan`：OL普通魏延已为狂骨／奇谋，选择完整re_weiyan；不用名称前缀判断普通／界版本。 [版本依据](https://www.sanguosha.com/hero/27)
- 庞德 → `re_pangde`：OL普通庞德鞬出按装备／非装备分支，使用re_pangde；界庞德ol_pangde按基本／非基本牌分支并增加杀次数，分别对应。 [版本依据](https://www.sanguosha.com/hero/39)
- 袁绍 → `re_yuanshao`：OL普通袁绍为同花色双手牌乱击／血裔，选择re_yuanshao。 [版本依据](https://www.sanguosha.com/hero/41)
- 张角 → `sp_zhangjiao`：OL普通张角为黑桃2雷、梅花回复并1雷的雷击，选择sp_zhangjiao；界版另用re_zhangjiao。 [版本依据](https://www.sanguosha.com/hero/212)
- 王基 → `wangji`：同平台原生历史文本差异：原生奇制明确选择不为该牌目标的角色，官网当前文字简写为另一名角色；保留固定原生完整规则。 [版本依据](https://www.sanguosha.com/hero/362)
- 陆抗 → `lukang`：同平台原生历史修订差异：固定决堰在当回合效果之外含整局增加杀次数／手牌上限／无距离等效果，并会修改决堰；官网当前页以本回合效果描述。本档完整保留固定原生，不改成官网文本。 [版本依据](https://www.sanguosha.com/hero/414)
- 张绣 → `zhangxiu`：雄乱／从谏与该平台版本相同；保留完整原生额外主公技踞襄及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.com/hero/415)
- 郭淮 → `guohuai`：同平台原生历史参数差异：官网精策摸牌数按本回合使用牌类型数描述，固定原生按本出牌阶段计算，保留原生文本及执行。 [版本依据](https://www.sanguosha.com/hero/175)
- 钟繇 → `zhongyao`：使用yijiang:zhongyao的OL活墨／佐定，不用mobile:mb_zhongyao。官网佐定条件写本阶段未伤害，固定原生写本回合，保留固定历史参数。 [版本依据](https://www.sanguosha.com/hero/334)
- 界黄忠 → `re_huangzhong`：OL界黄忠的烈弓对应原生黄忠（re_huangzhong）；原生OL黄忠（ol_huangzhong）另有非主公技没矢，不采用该候选。 [版本依据](https://www.sanguosha.com/hero/26)
- 界孙尚香 → `re_sunshangxiang`：同平台原生历史参数差异：固定结姻装备分支使用装备区内的一张牌，官网当前文字为将一张装备牌置入目标装备区，保留原生合法材料范围。 [版本依据](https://www.sanguosha.com/hero/443)
- 界孙坚 → `ol_sunjian`：英魂／武烈与OL界孙坚相同；保留完整原生额外主公技破虏及主公标记。 [版本依据](https://www.sanguosha.com/hero/458)
- 界徐盛 → `re_xusheng`：复核OL官方页的完整破军文本，含手牌数和装备数均不多于本人时伤害+1；固定原生repojun/repojun2/repojun3与此规则对应。原生显示名虽为手杀界徐盛，其规则与当前OL版相同，不采用带额外弃装备／摸牌的xin_xusheng。 [版本依据](https://www.sanguosha.com/hero/587)
- 界郭淮 → `ol_guohuai`：选择onlyOL:ol_guohuai，精策在每个出牌阶段结束时可触发；官网按本回合牌类型数，固定原生按本阶段类型数，保留同平台历史参数。 [版本依据](https://www.sanguosha.com/hero/658)
- 界关平 → `ol_guanping`：当前官网英雄目录尚未提供独立界关平页；按官方排位公告列名及固定onlyOL:ol_guanping的OL界标识、龙吟／竭勇审查，拒绝refresh:re_guanping的龙吟／竭忠。
- SP赵云 → `sp_zhaoyun`：同平台原生龙胆历史修订差异：官网仅列杀／闪互转；固定ollongdan同时支持桃／酒互转，冲阵仍只在龙胆杀／闪时夺取手牌，完整保留原生规则。 [版本依据](https://www.sanguosha.com/hero/108)
- 潘凤 → `re_panfeng`：OL狂斧为主动弃装备视为出杀版本，选择huicui:re_panfeng；不用standard:std_panfeng的旧狂斧。 [版本依据](https://www.sanguosha.com/hero/127)
- 刘琦 → `sp_liuqi`：同平台原生历史修订差异：官网问计为同牌名不能被响应，固定sp_liuqi为同类型；固定屯江亦保留原生判定条件，不改技能。 [版本依据](https://www.sanguosha.com/hero/378)
- 吕旷吕翔 → `lvkuanglvxiang`：OL为列侯／齐攻，使用sp:lvkuanglvxiang，不用dc_lvkuanglvxiang的数合／列侯。 [版本依据](https://www.sanguosha.com/hero/434)
- 逄纪 → `pangji`：官方排位表写逄纪，OL英雄页/679和原生sp:pangji写逢纪；核对均为愎果／斗誉，作为同角色异体写法收录。 [版本依据](https://www.sanguosha.com/hero/679)
- 刘璋 → `ol_liuzhang`：OL英雄页标题技能写丰蔚，原生写奉蔚，完整机制均为轮初摸牌留标与宗护，选ol_liuzhang，不用据土／邀虎／怀璧版。 [版本依据](https://www.sanguosha.com/hero/683)
- 董予安 → `ol_dongguiren`：原生ID仍为ol_dongguiren，显示名为董予安；以和煦／泽光／承恩三技能核对，不选新杀／其他平台董贵人。 [版本依据](https://www.sanguosha.com/hero/755)
- 司马师 → `jin_simashi`：OL公告的司马师对应晋势力隐匿版jin_simashi，完整保留韬隐／夷灭／睿略／泰然、主公标记及隐匿，不用败移／景略／擅立版simashi。 [版本依据](https://www.sanguosha.com/hero/7002)
- 界程普 → `ol_chengpu`：同平台历史参数差异：固定醇醪至多保存9张醇，官网当前页未列此上限，完整保留原生。 [版本依据](https://www.sanguosha.com/hero/620)
- 界关兴张苞 → `ol_guanzhang`：OL为仅父魂版，选择ol_guanzhang；不用含额外同心的re_guanzhang，父魂取得武圣／咆哮按固定原生定义。 [版本依据](https://www.sanguosha.com/hero/690)
- 谋邓艾 → `ol_sb_dengai`：同平台原生历史体力参数差异：OL英雄目录标5体力且未列初始体力，固定ol_sb_dengai为4/5；保留固定完整积谷／解腕及原生体力。 [版本依据](https://www.sanguosha.com/hero/601)
- 谋卢植 → `ol_sb_yl_luzhi`：同平台原生历史体力参数差异：OL英雄目录标4体力且未列初始体力，固定ol_sb_yl_luzhi为3/4；保留完整司兵／敛策及原生体力。 [版本依据](https://www.sanguosha.com/hero/692)
- 神典韦 → `shen_dianwei`：固定挈挟仅取描述含杀且不带锁定技之外标签的技能，转化武器离开装备区后放回武将堆；官网概括为排除觉醒／限定／转换／主公技及离场销毁。保留原生获取范围和武将堆回收，不改变将池白名单。 [版本依据](https://www.sanguosha.com/hero/229)
- 族钟繇 → `clan_zhongyao`：同平台原生历史势力参数差异：OL当前英雄目录标群，固定clan_zhongyao为魏；承启／诫厉／保族均对应OL，保留固定原生势力。 [版本依据](https://www.sanguosha.com/hero/630)
- 周群 → `ol_zhouqun`：同平台原生历史修订差异：官网天候于准备阶段观看顶一张、谶说于结束阶段自己展示；固定ol_zhouqun为结束阶段观看顶三张的天候、准备阶段可令一名角色展示的谶说，完整保留固定历史版本。 [版本依据](https://www.sanguosha.com/hero/543)
- 杨婉 → `yangwan`：同平台原生历史参数差异：官网诱言描述因弃置失牌，固定原生检测非使用或打出失牌；保留完整原生范围与秘密追还目标。 [版本依据](https://www.sanguosha.com/hero/499)
- 芮姬 → `ruiji`：同平台原生历史参数差异：固定清靓适用杀或锦囊牌，不局限当前官网的唯一目标伤害牌；巧力非武器分支摸装备时机亦按固定原生执行。 [版本依据](https://www.sanguosha.com/hero/502)
- 文鸯 → `wenyang`：核对OL官网膂力为造成伤害后调整手牌／体力，采用xianding:wenyang的xinlvli／choujue及后续觉醒技能；不采用手杀却敌／追锋／冲坚或diy_wenyang随机声明虚拟牌版本。 [版本依据](https://www.sanguosha.com/hero/517)
- 夏侯玄 → `xiahouxuan`：同平台原生历史修订差异：固定迮阅在每轮结束触发视为杀，官网当前为每轮开始，技能禁用范围亦按固定原生；不替换成新杀博玄／议政／归林。 [版本依据](https://www.sanguosha.com/hero/519)
- 陆郁生 → `ol_luyusheng`：OL为藏心／润微，选择ol_luyusheng；固定受伤时观看底三张，官网当前写展示，保留固定原生可见范围。 [版本依据](https://www.sanguosha.com/hero/562)
- 刘焉 → `liuyan`：按用户2026-10-10确认及OL官方武将页采用图射／立牧；junk_liuyan为偏安／殷积／窥伺的旧版本，不作为本档刘焉。 [版本依据](https://www.sanguosha.com/hero/634)
- 宣公主 → `xuangongzhu`：对应yingbian:xuangongzhu的晋势力隐匿版，高陵／齐眉／追姬三技能完整保留；不用newjiang:yj_xuangongzhu的双技能版。 [版本依据](https://www.sanguosha.com/hero/358)
- 夏侯徽 → `jin_xiahouhui`：对应晋势力隐匿版jin_xiahouhui的宝箧／宜室／识度，不用新杀笃君／济困。 [版本依据](https://www.sanguosha.com/hero/7001)
- 司马昭 → `jin_simazhao`：对应晋势力隐匿版jin_simazhao的推弑／筹伐／昭然／成务，完整保留主公与隐匿标记。 [版本依据](https://www.sanguosha.com/hero/7004)
- 王元姬 → `jin_wangyuanji`：对应晋势力隐匿版jin_wangyuanji的识人／宴戏，不用手杀谦冲／尚俭或新杀识预／率俭。 [版本依据](https://www.sanguosha.com/hero/7005)
- 贾充 → `jin_jiachong`：对应yingbian:jin_jiachong的凶竖／奸回，拒绝TW的浮伪／滋愎及手杀／新杀悖逆版本。 [版本依据](https://www.sanguosha.com/hero/7019)
- 曹婴 → `caoying`：同平台原生历史修订差异：固定凌人每回合一次、下一次伤害+1，猜中两项还不计次数，三项获界奸雄／界行殇；伏间在准备与结束阶段看一名手牌数不为唯一最多者的整手。官网仍为出牌阶段凌人、当前牌增伤及结束阶段看最少手牌数张，完整保留固定OL版本。 [版本依据](https://www.sanguosha.com/hero/353)
- 张琪瑛 → `zhangqiying`：同平台原生历史修订差异：固定点化可置牌堆底、真仪后土可于回合外使用一张牌当桃且玉清直接加伤；官网当前分别只列牌堆顶、濒死手牌当桃与判黑加伤。完整保留固定OL原生版本。 [版本依据](https://www.sanguosha.com/hero/425)
- 曹纯 → `caochun`：同平台原生历史缮甲修订差异：官网为出牌阶段开始摸3并立即弃3−已失装备数；固定olshanjia为3枚损标记、出牌阶段主动摸3且可出杀，随后使用前X张手牌时付弃牌，阶段结束可再视为出杀。保留完整原生OL修订规则，未替换为手杀缮甲。 [版本依据](https://www.sanguosha.com/hero/426)
- 潘淑 → `panshu`：同平台原生历史参数差异：固定锦织成本为本轮此前次数+1张，官网当前写本轮次数；保留原生递增成本。 [版本依据](https://www.sanguosha.com/hero/478)
- 冯方女 → `fengfangnv`：OL英雄页为冯方女，固定原生显示OL冯妤，ID仍为fengfangnv，妆梳／垂涕对应。历史参数差异：原生只在目标宝物区空时造宝梳，官网当前可移动已有宝梳，保留原生完整技能。 [版本依据](https://www.sanguosha.com/hero/491)
- 界沮授：[平台技能依据](https://www.sanguosha.com/hero/749)；排除 `re_jushou`、`xin_jushou`。
- 谋周瑜：[平台技能依据](https://www.sanguosha.com/hero/770)；排除 `sb_zhouyu`、`dc_sb_zhouyu`。
- 唐棠：[平台技能依据](https://www.sanguosha.com/hero/744)；固定引擎无同名原生候选。
- 谢灵毓：[平台技能依据](https://www.sanguosha.com/hero/769)；排除 `xielingyu`。

## OL SGL第一赛段（2026）

[官方公告](https://www.sanguosha.com/news/20260608_6402_4317) · [公告将池原图1](https://wwwoss.sanguosha.com/uploads/202606/V1kSqX0hQtMpSgT8.png?x-oss-process=image/quality,q_80) · [公告将池原图2](https://wwwoss.sanguosha.com/uploads/202606/DLC9cPFv6ftUj9kT.png?x-oss-process=image/quality,q_80)；发布于 2026-06-08。对应原活动斗地主，本项目可用于现有四模式。

| 公告／目录武将 | 原生ID             | 定义包   | 原生技能 / 缺项原因       |
| -------------- | ------------------ | -------- | ------------------------- |
| 谋邓艾         | `ol_sb_dengai`     | onlyOL   | 积谷 / 解腕               |
| 谋董卓         | `ol_sb_dongzhuo`   | onlyOL   | 观变 / 凶逆 / 封赏 / 执柄 |
| 谋公孙瓒       | `ol_sb_gongsunzan` | onlyOL   | 剿狄 / 保京               |
| 谋关羽         | `ol_sb_guanyu`     | onlyOL   | 威临 / 夺首               |
| 谋华雄         | `ol_sb_huaxiong`   | onlyOL   | 搏决 / 扬威               |
| 谋孙坚         | `ol_sb_sunjian`    | onlyOL   | 虎烈 / 毅魄               |
| 谋文丑         | `ol_sb_wenchou`    | onlyOL   | 轮战 / 决绝               |
| 谋小乔         | `ol_sb_xiaoqiao`   | onlyOL   | 迷落 / 绝颜               |
| 谋许攸         | `ol_sb_xuyou`      | onlyOL   | 迁附 / 驭势 / 焚巢        |
| 谋袁术         | `ol_sb_yuanshu`    | onlyOL   | 矜名 / 枭噬 / 厌粱        |
| 谋张绣         | `ol_sb_zhangxiu`   | onlyOL   | 仇猎 / 追剿               |
| 谋诸葛亮       | `ol_sb_zhugeliang` | onlyOL   | 知天 / 武靖 / 智绝        |
| 张绣           | `zhangxiu`         | shenhua  | 雄乱 / 从谏 / 踞襄        |
| 魔曹操         | `dm_caocao`        | onlyOL   | 霸朝 / 覆载               |
| 魔貂蝉         | `dm_diaochan`      | onlyOL   | 幻惑 / 倾世               |
| 魔吕布         | `dm_lvbu`          | onlyOL   | 夺炁 / 狂魔 / 罡拳        |
| 魔司马懿       | `dm_simayi`        | onlyOL   | 诡伏 / 谋变               |
| 魔孙权         | `dm_sunquan`       | onlyOL   | 权御 / 天恩 / 乾纲        |
| 神典韦         | `shen_dianwei`     | onlyOL   | 捐甲 / 挈挟 / 摧决        |
| 神甘宁         | `shen_ganning`     | extra    | 魄袭 / 劫营               |
| 神陆逊         | `shen_luxun`       | extra    | 军略 / 摧克 / 绽火        |
| 神张角         | `junk_zhangjiao`   | onlyOL   | 异兆 / 肆军 / 天劫        |
| 神赵云         | `shen_zhaoyun`     | extra    | 绝境 / 龙魂               |
| 界黄盖         | `re_huanggai`      | refresh  | 苦肉 / 诈降               |
| 界李儒         | `ol_liru`          | onlyOL   | 绝策 / 灭计 / 焚城        |
| 界王异         | `ol_wangyi`        | onlyOL   | 贞烈 / 秘计               |
| 界魏延         | `ol_weiyan`        | refresh  | 狂骨 / 奇谋               |
| 界徐盛         | `re_xusheng`       | mobile   | 破军                      |
| 界张春华       | `ol_zhangchunhua`  | onlyOL   | 绝情 / 伤逝 / 翦灭        |
| 秦宓           | `qinmi`            | yijiang  | 谏征 / 专对 / 天辩        |
| 吴懿           | `wuyi`             | yijiang  | 奔袭                      |
| 张让           | `zhangrang`        | yijiang  | 滔乱                      |
| 杜预           | `duyu`             | yingbian | 三陈 / 昭讨               |
| 杨艳           | `yangyan`          | yingbian | 选备 / 娴婉               |
| 杨芷           | `yangzhi`          | yingbian | 婉嫕 / 埋祸               |
| 鲍信           | `baoxin`           | mobile   | 募讨 / 毅谋               |
| 曹叡           | `caorui`           | yijiang  | 恢拓 / 明鉴 / 兴衰        |
| 丁尚涴         | `ol_dingshangwan`  | sp       | 抚悼 / 讽言               |
| 胡金定         | `ol_hujinding`     | sp       | 轻缘 / 重身               |
| 张曼成         | `ol_zhangmancheng` | sp       | 狂信 / 雷噬               |
| 李傕           | `lijue`            | sp2      | 狼袭 / 亦算               |
| 刘琦           | `sp_liuqi`         | sp2      | 问计 / 屯江               |
| 刘谌           | `liuchen`          | yijiang  | 战绝 / 勤王               |
| 鲁芝           | `luzhi`            | sp       | 清忠 / 卫境               |
| 吕伯奢         | `lvboshe`          | sp       | 缚豕 / 东道               |
| 马良           | `ol_maliang`       | diy      | 自书 / 应援               |
| 马元义         | `mayuanyi`         | mobile   | 集兵 / 往京 / 谋篡        |
| 彭羕           | `ol_pengyang`      | sp       | 嚣翻 / 侻失 / 寸目        |
| 麹义           | `quyi`             | sp       | 伏骑 / 骄恣               |
| 沙摩柯         | `shamoke`          | sp       | 蒺藜                      |
| 滕芳兰         | `tengfanglan`      | sp       | 落宠 / 哀尘               |
| 文鸯           | `wenyang`          | xianding | 膂力 / 仇决               |
| 戏志才         | `xizhicai`         | sp       | 天妒 / 先辅 / 筹策        |
| 阎柔           | `yanrou`           | sp2      | 仇讨 / 襄戍               |
| 辛毗           | `xinpi`            | sp2      | 持节 / 引裾               |
| 袁姬           | `ol_yuanji`        | sp       | 节言 / 镜花 / 水月        |
| 张华           | `zhanghua`         | sp       | 弼昏 / 剑合 / 穿屋        |
| 张芝           | `zhangzhi`         | sp       | 笔心 / 洗墨               |
| 诸葛恪         | `zhugeke`          | sp       | 傲才 / 黩武               |
| 族陆绩         | `clan_luji`        | clan     | 该览 / 奋驽 / 泽烈        |
| 族荀采         | `clan_xuncai`      | clan     | 烈誓 / 点盏 / 还阴 / 蹈节 |
| 族荀谌         | `clan_xunchen`     | clan     | 三恇 / 卑势 / 蹈节        |
| 族荀莳         | `clan_xunshi`      | clan     | 清绝 / 萦香 / 蹈节        |
| 族荀攸         | `clan_xunyou`      | clan     | 百出 / 蹈节               |
| 族荀彧         | `clan_xunyu`       | clan     | 定安 / 抚宁 / 蹈节        |
| 族杨彪         | `clan_yangbiao`    | clan     | 间难 / 义叱 / 去惑        |
| 族钟会         | `clan_zhonghui`    | clan     | 迂志 / 挟术 / 保族        |
| 族钟琰         | `clan_zhongyan`    | clan     | 观骨 / 啸咏 / 保族        |
| 鲍三娘         | `baosanniang`      | sp       | 武娘 / 镇南 / 许身        |
| 曹纯           | `caochun`          | sp       | 缮甲                      |
| 曹婴           | `caoying`          | sp       | 凌人 / 伏间               |
| 费祎           | `ol_feiyi`         | sp       | 晏如 / 和衷               |
| 郭照           | `ol_guozhao`       | sp       | 椒遇 / 内训               |
| 蒋琬           | `ol_jiangwan`      | sp       | 自若 / 蓄发               |
| 徐荣           | `xurong`           | xianding | 凶镬 / 杀绝               |
| 周处           | `jin_zhouchu`      | sp       | 善断 / 义烈               |
| 吕玲绮         | `ol_lvlingqi`      | sp       | 绮武 / 妆戎               |
| SP刘备         | `sp_ol_liubei`     | sp       | 虚待 / 煮酒 / 惊雷        |
| SP孙策         | `sp_sunce`         | sp       | 连讨                      |
| SP张郃         | `sp_ol_zhanghe`    | sp       | 周旋                      |
| SP赵云         | `sp_zhaoyun`       | sp       | 龙胆 / 冲阵               |
| 祢衡           | `ol_miheng`        | sp       | 狂狷 / 飞辩               |
| 蒲元           | `ol_puyuan`        | sp       | 神工 / 奇思               |

- 谋邓艾 → `ol_sb_dengai`：同平台原生历史体力参数差异：OL英雄目录标5体力且未列初始体力，固定ol_sb_dengai为4/5；保留固定完整积谷／解腕及原生体力。 [版本依据](https://www.sanguosha.com/hero/601)
- 张绣 → `zhangxiu`：雄乱／从谏与该平台版本相同；保留完整原生额外主公技踞襄及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.com/hero/415)
- 神典韦 → `shen_dianwei`：固定挈挟仅取描述含杀且不带锁定技之外标签的技能，转化武器离开装备区后放回武将堆；官网概括为排除觉醒／限定／转换／主公技及离场销毁。保留原生获取范围和武将堆回收，不改变将池白名单。 [版本依据](https://www.sanguosha.com/hero/229)
- 神赵云 → `shen_zhaoyun`：已核对OL官方绝境／龙魂全文，对应shen_zhaoyun的同花色1至2张转化版本；不采用旧神赵云按体力值转化版本。 [版本依据](https://www.sanguosha.com/hero/207)
- 界徐盛 → `re_xusheng`：复核OL官方页的完整破军文本，含手牌数和装备数均不多于本人时伤害+1；固定原生repojun/repojun2/repojun3与此规则对应。原生显示名虽为手杀界徐盛，其规则与当前OL版相同，不采用带额外弃装备／摸牌的xin_xusheng。 [版本依据](https://www.sanguosha.com/hero/587)
- 张让 → `zhangrang`：同平台原生历史限制差异：官网滔乱注明场上无人处于濒死状态；固定taoluan未加此限制，仍完整保留每牌名限一次、异类交牌或失去体力并失效规则，不改技能。 [版本依据](https://www.sanguosha.com/hero/387)
- 杜预 → `duyu`：公告文德武备杜预对应晋势力yingbian:duyu的三陈／昭讨／觉醒破竹，不采用手杀武库／三陈或新杀谏国／倾势版本。固定三陈仅选择本回合未选过的角色，官网为成功弃置三种类别后才排除该目标，保留原生历史限制。 [版本依据](https://www.sanguosha.com/hero/7006)
- 杨艳 → `yangyan`：对应OL文德武备选备／娴婉；固定xinxuanbei源码以target.canUse(cardx, player, false)绕过距离检查，不能仅凭技能文本未写无距离限制而排除。 [版本依据](https://www.sanguosha.com/hero/7016)
- 鲍信 → `baoxin`：核对OL官方募讨／毅谋全文，与固定mobile:baoxin同为分发所有杀后随机伤害、近距受伤获杀或给牌摸牌，技能和参数一致；原生所在包名不作为平台差异依据。 [版本依据](https://www.sanguosha.com/hero/728)
- 刘琦 → `sp_liuqi`：同平台原生历史修订差异：官网问计为同牌名不能被响应，固定sp_liuqi为同类型；固定屯江亦保留原生判定条件，不改技能。 [版本依据](https://www.sanguosha.com/hero/378)
- 马良 → `ol_maliang`：OL应援从牌堆获得同类型牌；移动版 maliang 交出用过的牌，必须分别选择。 [版本依据](https://www.sanguosha.com/hero/128)
- 马元义 → `mayuanyi`：核对OL官方集兵／往京／谋篡全文，与固定mobile:mayuanyi的势力数兵牌、最高体力用兵摸牌及觉醒兵祸一致；包名不作为平台差异依据。 [版本依据](https://www.sanguosha.com/hero/669)
- 文鸯 → `wenyang`：核对OL官网膂力为造成伤害后调整手牌／体力，采用xianding:wenyang的xinlvli／choujue及后续觉醒技能；不采用手杀却敌／追锋／冲坚或diy_wenyang随机声明虚拟牌版本。 [版本依据](https://www.sanguosha.com/hero/517)
- 辛毗 → `xinpi`：同平台原生历史触发／次数差异：官网持节为每回合共限一次、受到伤害后令伤害牌无效，或获得未造成伤害的牌；固定xpchijie为每项各限一次、牌对本人结算后令后续目标无效。引裾仍为限定的目标共摸牌／防伤改回血，保留完整原生。 [版本依据](https://www.sanguosha.com/hero/435)
- 鲍三娘 → `baosanniang`：同平台原生许身历史差异：固定newxushen处理目标失去技能获征南或获得镇南，但未实现官网许身末句回复本人至1点体力；保留完整固定武娘／镇南／许身，不给原生补写回复效果。 [版本依据](https://www.sanguosha.com/hero/351)
- 曹纯 → `caochun`：同平台原生历史缮甲修订差异：官网为出牌阶段开始摸3并立即弃3−已失装备数；固定olshanjia为3枚损标记、出牌阶段主动摸3且可出杀，随后使用前X张手牌时付弃牌，阶段结束可再视为出杀。保留完整原生OL修订规则，未替换为手杀缮甲。 [版本依据](https://www.sanguosha.com/hero/426)
- 曹婴 → `caoying`：同平台原生历史修订差异：固定凌人每回合一次、下一次伤害+1，猜中两项还不计次数，三项获界奸雄／界行殇；伏间在准备与结束阶段看一名手牌数不为唯一最多者的整手。官网仍为出牌阶段凌人、当前牌增伤及结束阶段看最少手牌数张，完整保留固定OL版本。 [版本依据](https://www.sanguosha.com/hero/353)
- 徐荣 → `xurong`：同平台原生历史取牌参数差异：官网凶镬第三项为随机获得对方一张手牌及一张装备牌；固定xurong为从其手牌／装备区随机获得两张牌，保留完整原生。 [版本依据](https://www.sanguosha.com/hero/417)
- SP赵云 → `sp_zhaoyun`：同平台原生龙胆历史修订差异：官网仅列杀／闪互转；固定ollongdan同时支持桃／酒互转，冲阵仍只在龙胆杀／闪时夺取手牌，完整保留原生规则。 [版本依据](https://www.sanguosha.com/hero/108)

## 手杀斗地主·时光场（公开目录）

[公开客户端目录来源](https://www.sanguosha.cn/)；读取于 2026-10-11。对应原活动斗地主，本项目可用于现有四模式。

根据2026-10-11读取的公开客户端固定目录核对；目录包含326名候选，不代表商业服务器当日开放状态或任何账号权益。技能依据为该目录记录的SpellData，散列见研究文件。仅提供将池，沿用本项目四模式。

| 公告／目录武将 | 原生ID              | 定义包   | 原生技能 / 缺项原因                                                                              |
| -------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| 刘备           | `liubei`            | standard | 仁德 / 激将                                                                                      |
| 关羽           | `guanyu`            | standard | 武圣                                                                                             |
| 张飞           | `zhangfei`          | standard | 咆哮                                                                                             |
| 诸葛亮         | `zhugeliang`        | standard | 观星 / 空城                                                                                      |
| 赵云           | `zhaoyun`           | standard | 龙胆                                                                                             |
| 马超           | `machao`            | standard | 马术 / 铁骑                                                                                      |
| 黄月英         | `huangyueying`      | standard | 集智 / 奇才                                                                                      |
| 孙权           | `sunquan`           | standard | 制衡 / 救援                                                                                      |
| 甘宁           | `ganning`           | standard | 奇袭                                                                                             |
| 吕蒙           | `lvmeng`            | standard | 克己                                                                                             |
| 黄盖           | `huanggai`          | standard | 苦肉                                                                                             |
| 周瑜           | `zhouyu`            | standard | 英姿 / 反间                                                                                      |
| 大乔           | `daqiao`            | standard | 国色 / 流离                                                                                      |
| 陆逊           | `luxun`             | standard | 谦逊 / 连营                                                                                      |
| 曹操           | `caocao`            | standard | 奸雄 / 护驾                                                                                      |
| 司马懿         | `simayi`            | standard | 反馈 / 鬼才                                                                                      |
| 夏侯惇         | `xiahoudun`         | standard | 刚烈                                                                                             |
| 张辽           | `zhangliao`         | standard | 突袭                                                                                             |
| 许褚           | `xuzhu`             | standard | 裸衣                                                                                             |
| 郭嘉           | `guojia`            | standard | 天妒 / 遗计                                                                                      |
| 甄姬           | `zhenji`            | standard | 洛神 / 倾国                                                                                      |
| 华佗           | `huatuo`            | standard | 青囊 / 急救                                                                                      |
| 吕布           | `lvbu`              | standard | 无双                                                                                             |
| 貂蝉           | `diaochan`          | standard | 离间 / 闭月                                                                                      |
| 孙尚香         | `sunshangxiang`     | standard | 枭姬 / 结姻                                                                                      |
| 黄忠           | `huangzhong`        | old      | 烈弓                                                                                             |
| 魏延           | `weiyan`            | old      | 狂骨                                                                                             |
| 夏侯渊         | `xiahouyuan`        | old      | 神速                                                                                             |
| 曹仁           | `old_caoren`        | shenhua  | 据守                                                                                             |
| 小乔           | `old_xiaoqiao`      | old      | 天香 / 红颜                                                                                      |
| 周泰           | `old_zhoutai`       | shenhua  | 不屈                                                                                             |
| 张角           | `zhangjiao`         | old      | 雷击 / 鬼道 / 黄天                                                                               |
| 于吉           | `yuji`              | old      | 蛊惑                                                                                             |
| 典韦           | **缺项**            | —        | 固定引擎典韦的强袭次数、距离或额外非主公技不同，没有每阶段一次且受攻击范围限制的完整原生版本。   |
| 荀彧           | `xunyu`             | shenhua  | 驱虎 / 节命                                                                                      |
| 庞统           | `pangtong`          | shenhua  | 连环 / 涅槃                                                                                      |
| 卧龙诸葛       | `sp_zhugeliang`     | shenhua  | 八阵 / 火计 / 看破                                                                               |
| 太史慈         | `taishici`          | shenhua  | 天义                                                                                             |
| 庞德           | `pangde`            | old      | 马术 / 猛进                                                                                      |
| 颜良文丑       | `yanwen`            | shenhua  | 双雄                                                                                             |
| 袁绍           | `re_yuanshao`       | shenhua  | 乱击 / 血裔                                                                                      |
| 徐晃           | `xuhuang`           | old      | 断粮                                                                                             |
| 曹丕           | `caopi`             | shenhua  | 行殇 / 放逐 / 颂威                                                                               |
| 孙坚           | `sunjian`           | shenhua  | 英魂                                                                                             |
| 董卓           | `dongzhuo`          | shenhua  | 酒池 / 肉林 / 崩坏 / 暴虐                                                                        |
| 祝融           | `zhurong`           | shenhua  | 巨象 / 烈刃                                                                                      |
| 孟获           | **缺项**            | —        | 原生孟获再起翻牌数为已损失体力值+1；公开目录版本为已损失体力值，不能仅忽略额外主公技便视作相同。 |
| 贾诩           | `jiaxu`             | shenhua  | 乱武 / 完杀 / 帷幕                                                                               |
| 鲁肃           | `re_lusu`           | shenhua  | 好施 / 缔盟                                                                                      |
| 张郃           | `zhanghe`           | shenhua  | 巧变                                                                                             |
| 邓艾           | `dengai`            | shenhua  | 屯田 / 凿险                                                                                      |
| 姜维           | **缺项**            | —        | 原生姜维志继获得界观星；目录版本获得普通观星，觉醒后的非主公技能不同。                           |
| 刘禅           | `liushan`           | shenhua  | 享乐 / 放权 / 若愚                                                                               |
| 孙策           | **缺项**            | —        | 原生孙策魂姿获得锁定的界英姿；目录版本获得普通英姿，觉醒后的非主公技能不同。                     |
| 张昭张纮       | `zhangzhang`        | shenhua  | 直谏 / 固政                                                                                      |
| 左慈           | `zuoci`             | shenhua  | 化身 / 新生                                                                                      |
| 蔡文姬         | `caiwenji`          | shenhua  | 悲歌 / 断肠                                                                                      |
| 华雄           | `huaxiong`          | standard | 耀武                                                                                             |
| 袁术           | `re_yuanshu`        | standard | 妄尊 / 同疾                                                                                      |
| 王基           | `wangji`            | shenhua  | 奇制 / 进趋                                                                                      |
| 严颜           | `yanyan`            | shenhua  | 拒战                                                                                             |
| 王平           | `wangping`          | shenhua  | 飞军 / 兵略                                                                                      |
| 陆绩           | `luji`              | shenhua  | 怀橘 / 遗礼 / 整论                                                                               |
| 孙亮           | `xin_sunliang`      | mobile   | 掣政 / 溃诛 / 立军                                                                               |
| 蒯越蒯良       | `kuailiangkuaiyue`  | shenhua  | 荐降 / 审时                                                                                      |
| 许攸           | **缺项**            | —        | 原生许攸成略含转换与不同的持续期限，不能用相同技能名代替目录中的完整效果。                       |
| 卢植           | **缺项**            | —        | 原生卢植明任的摸牌数、贞良的消耗和判断条件不同。                                                 |
| 毌丘俭         | `re_guanqiujian`    | mobile   | 征荣 / 鸿举                                                                                      |
| 陈到           | `old_chendao`       | old      | 往烈                                                                                             |
| 诸葛瞻         | `zhugezhan`         | shenhua  | 罪论 / 父荫                                                                                      |
| 周妃           | **缺项**            | —        | 原生周妃良姻、箜声的触发或手牌数限制与目录版本不同。                                             |
| 陆抗           | **缺项**            | —        | 原生陆抗决堰包含永久改写，目录版本的对应加成为本回合效果。                                       |
| 张绣           | `zhangxiu`          | shenhua  | 雄乱 / 从谏 / 踞襄                                                                               |
| 郝昭           | `haozhao`           | shenhua  | 镇骨                                                                                             |
| 仲帝袁术       | `yl_yuanshu`        | shenhua  | 庸肆 / 伪帝                                                                                      |
| 界袁术         | `old_yuanshu`       | mobile   | 庸肆 / 觊玺                                                                                      |
| 界华雄         | `ol_huaxiong`       | old      | 耀武                                                                                             |
| 界周泰         | `xin_zhoutai`       | mobile   | 不屈 / 奋激                                                                                      |
| 界于吉         | `re_yuji`           | shenhua  | 蛊惑                                                                                             |
| 界张角         | `sp_zhangjiao`      | shenhua  | 雷击 / 鬼道 / 黄天                                                                               |
| 界刘备         | `re_liubei`         | refresh  | 仁德 / 激将                                                                                      |
| 界关羽         | `re_guanyu`         | refresh  | 武圣 / 义绝                                                                                      |
| 界张飞         | `xin_zhangfei`      | mobile   | 咆哮 / 厉勇                                                                                      |
| 界赵云         | `old_zhaoyun`       | old      | 龙胆 / 涯角                                                                                      |
| 界马超         | **缺项**            | —        | 原生界马超铁骑的交牌与伤害效果不同，没有对应目录弃牌响应方式的完整原生版本。                     |
| 界甘宁         | `re_ganning`        | refresh  | 奇袭 / 奋威                                                                                      |
| 界吕蒙         | **缺项**            | —        | 原生界吕蒙多出非主公技博图，勤学觉醒条件也不同。                                                 |
| 界黄盖         | `re_huanggai`       | refresh  | 苦肉 / 诈降                                                                                      |
| 界周瑜         | `re_zhouyu`         | refresh  | 英姿 / 反间                                                                                      |
| 界陆逊         | `re_luxun`          | refresh  | 谦逊 / 连营                                                                                      |
| 界曹操         | `re_caocao`         | refresh  | 奸雄 / 护驾                                                                                      |
| 界司马懿       | `re_simayi`         | refresh  | 反馈 / 鬼才                                                                                      |
| 界夏侯惇       | `xin_xiahoudun`     | mobile   | 刚烈 / 清俭                                                                                      |
| 界张辽         | `re_zhangliao`      | refresh  | 突袭                                                                                             |
| 界许褚         | `re_xuzhu`          | refresh  | 裸衣                                                                                             |
| 界郭嘉         | `re_guojia`         | refresh  | 天妒 / 遗计                                                                                      |
| 界华佗         | `re_huatuo`         | refresh  | 急救 / 青囊                                                                                      |
| 界吕布         | `re_lvbu`           | refresh  | 无双 / 利驭                                                                                      |
| 界黄月英       | `re_huangyueying`   | refresh  | 集智 / 奇才                                                                                      |
| 界诸葛亮       | `re_zhugeliang`     | refresh  | 观星 / 空城                                                                                      |
| 界孙权         | `re_sunquan`        | refresh  | 制衡 / 救援                                                                                      |
| 界孙尚香       | `re_sunshangxiang`  | refresh  | 枭姬 / 结姻                                                                                      |
| 界甄姬         | `re_zhenji`         | refresh  | 洛神 / 倾国                                                                                      |
| 界貂蝉         | `re_diaochan`       | refresh  | 离间 / 闭月                                                                                      |
| 界伊籍         | `xf_yiji`           | standard | 机捷 / 急援                                                                                      |
| 界卧龙诸葛     | `re_sp_zhugeliang`  | mobile   | 八阵 / 火计 / 看破                                                                               |
| 界典韦         | `re_dianwei`        | mobile   | 强袭                                                                                             |
| 界荀彧         | `re_xunyu`          | mobile   | 驱虎 / 节命                                                                                      |
| 界庞德         | `re_pangde`         | shenhua  | 马术 / 鞬出                                                                                      |
| 界庞统         | `re_pangtong`       | mobile   | 连环 / 涅槃                                                                                      |
| 界颜良文丑     | `re_yanwen`         | mobile   | 双雄                                                                                             |
| 界袁绍         | `xin_yuanshao`      | mobile   | 乱击 / 血裔                                                                                      |
| 界徐晃         | `re_xuhuang`        | shenhua  | 断粮 / 截辎                                                                                      |
| 界孟获         | `re_menghuo`        | refresh  | 祸首 / 再起 / 酋首                                                                               |
| 界祝融         | `re_zhurong`        | mobile   | 巨象 / 烈刃                                                                                      |
| 界曹丕         | `re_caopi`          | refresh  | 行殇 / 放逐 / 颂威                                                                               |
| 界孙坚         | `re_sunjian`        | mobile   | 英魂 / 破虏                                                                                      |
| 界董卓         | `re_dongzhuo`       | mobile   | 酒池 / 肉林 / 崩坏 / 暴虐                                                                        |
| 界邓艾         | `re_dengai`         | mobile   | 屯田 / 凿险                                                                                      |
| 界姜维         | `re_jiangwei`       | mobile   | 挑衅 / 志继                                                                                      |
| 界蔡文姬       | `re_caiwenji`       | mobile   | 悲歌 / 断肠                                                                                      |
| 界孙策         | **缺项**            | —        | 目录界孙策魂姿为体力值不大于2；原生候选的觉醒阈值及激昂效果不同。                                |
| 界张昭张纮     | `re_zhangzhang`     | mobile   | 直谏 / 固政                                                                                      |
| 界刘禅         | `re_liushan`        | mobile   | 享乐 / 放权 / 若愚                                                                               |
| 界黄忠         | `re_huangzhong`     | shenhua  | 烈弓                                                                                             |
| 界魏延         | `re_weiyan`         | shenhua  | 狂骨 / 奇谋                                                                                      |
| 界夏侯渊       | `re_xiahouyuan`     | shenhua  | 神速                                                                                             |
| 界曹仁         | `caoren`            | refresh  | 据守 / 解围                                                                                      |
| 界小乔         | `re_xiaoqiao`       | mobile   | 天香 / 红颜                                                                                      |
| 曹植           | `caozhi`            | yijiang  | 落英 / 酒诗                                                                                      |
| 高顺           | **缺项**            | —        | 原生旧高顺陷阵仅对杀解除次数限制，其他候选又多出非主公效果，不能对应目录版本。                   |
| 陈宫           | `chengong`          | yijiang  | 明策 / 智迟                                                                                      |
| 法正           | `fazheng`           | old      | 恩怨 / 眩惑                                                                                      |
| 凌统           | `lingtong`          | yijiang  | 旋风                                                                                             |
| 马谡           | **缺项**            | —        | 原生马谡散谣的目标数量或判断条件不同，未找到相同散谣／制蛮的完整原生角色。                       |
| 吴国太         | `wuguotai`          | yijiang  | 甘露 / 补益                                                                                      |
| 徐盛           | `xusheng`           | yijiang  | 破军                                                                                             |
| 于禁           | **缺项**            | —        | 固定引擎未保留目录中以节钺牌转换红闪黑无懈的完整于禁版本。                                       |
| 张春华         | `zhangchunhua`      | yijiang  | 绝情 / 伤逝                                                                                      |
| 曹彰           | **缺项**            | —        | 原生曹彰将驰的触发时机、消耗或额外手牌上限效果不同。                                             |
| 王异           | `old_wangyi`        | old      | 贞烈 / 秘计                                                                                      |
| 荀攸           | `xunyou`            | yijiang  | 奇策 / 智愚                                                                                      |
| 关兴张苞       | `old_guanzhang`     | old      | 父魂                                                                                             |
| 廖化           | `liaohua`           | yijiang  | 当先 / 伏枥                                                                                      |
| 步练师         | **缺项**            | —        | 原生步练师安恤的摸牌、回复和手牌平衡效果与目录版本不同。                                         |
| 程普           | `chengpu`           | yijiang  | 疠火 / 醇醪                                                                                      |
| 韩当           | `handang`           | yijiang  | 弓骑 / 解烦                                                                                      |
| 刘表           | **缺项**            | —        | 原生刘表自守／宗室含伤害防止或杀的次数加成，与目录版本不同。                                     |
| 钟会           | `zhonghui`          | yijiang  | 权计 / 自立                                                                                      |
| 曹冲           | `caochong`          | yijiang  | 称象 / 仁心                                                                                      |
| 郭淮           | **缺项**            | —        | 原生郭淮精策已改为花色／类别计数或结束阶段结算，没有目录出牌阶段末按使用牌数摸二的完整版本。     |
| 满宠           | `manchong`          | yijiang  | 峻刑 / 御策                                                                                      |
| 关平           | `guanping`          | yijiang  | 龙吟                                                                                             |
| 简雍           | `jianyong`          | yijiang  | 巧说 / 纵适                                                                                      |
| 刘封           | `liufeng`           | yijiang  | 陷嗣                                                                                             |
| 潘璋马忠       | `panzhangmazhong`   | yijiang  | 夺刀 / 暗箭                                                                                      |
| 虞翻           | `yufan`             | yijiang  | 直言 / 纵玄                                                                                      |
| 朱然           | `zhuran`            | yijiang  | 胆守                                                                                             |
| 伏皇后         | `fuhuanghou`        | yijiang  | 求援 / 惴恐                                                                                      |
| 李儒           | `xin_liru`          | yijiang  | 绝策 / 灭计 / 焚城                                                                               |
| 徐庶           | `xin_xushu`         | yijiang  | 无言 / 举荐                                                                                      |
| 马岱           | `madai`             | old      | 马术 / 潜袭                                                                                      |
| 公孙瓒         | `re_gongsunzan`     | refresh  | 趫猛 / 义从                                                                                      |
| 曹真           | `old_caozhen`       | old      | 司敌                                                                                             |
| 韩浩史涣       | `hanhaoshihuan`     | yijiang  | 慎断 / 勇略                                                                                      |
| 陈群           | `old_chenqun`       | old      | 定品 / 法恩                                                                                      |
| 吴懿           | `old_wuyi`          | old      | 奔袭                                                                                             |
| 周仓           | **缺项**            | —        | 原生周仓忠勇的交牌对象、可交的牌与追加杀效果不同。                                               |
| 张松           | `zhangsong`         | yijiang  | 强识 / 献图                                                                                      |
| 孙鲁班         | `sunluban`          | yijiang  | 谮毁 / 骄矜                                                                                      |
| 朱桓           | `zhuhuan`           | yijiang  | 奋励 / 平寇                                                                                      |
| 顾雍           | **缺项**            | —        | 原生顾雍秉壹的触发时机或额外奖励不同。                                                           |
| 沮授           | `yj_jushou`         | yijiang  | 渐营 / 矢北                                                                                      |
| 蔡夫人         | `caifuren`          | yijiang  | 窃听 / 献州                                                                                      |
| 曹叡           | `caorui`            | yijiang  | 恢拓 / 明鉴 / 兴衰                                                                               |
| 曹休           | `caoxiu`            | yijiang  | 千驹 / 倾袭                                                                                      |
| 钟繇           | `mb_zhongyao`       | mobile   | 活墨 / 佐定                                                                                      |
| 刘谌           | `liuchen`           | yijiang  | 战绝 / 勤王                                                                                      |
| 夏侯氏         | `xiahoushi`         | yijiang  | 樵拾 / 燕语                                                                                      |
| 张嶷           | `zhangyi`           | yijiang  | 怃戎 / 矢志                                                                                      |
| 孙休           | `sunxiu`            | yijiang  | 宴诛 / 兴学 / 诏缚                                                                               |
| 朱治           | `old_zhuzhi`        | old      | 安国                                                                                             |
| 全琮           | `quancong`          | yijiang  | 邀名                                                                                             |
| 公孙渊         | `gongsunyuan`       | yijiang  | 怀异                                                                                             |
| 郭图逢纪       | `guotufengji`       | yijiang  | 急攻 / 饰非                                                                                      |
| 界马岱         | `old_madai`         | yijiang  | 马术 / 潜袭                                                                                      |
| 界法正         | `xin_fazheng`       | yijiang  | 眩惑 / 恩怨                                                                                      |
| 界王异         | `re_wangyi`         | refresh  | 贞烈 / 秘计                                                                                      |
| 界关兴张苞     | `guanzhang`         | yijiang  | 父魂                                                                                             |
| 界徐盛         | `re_xusheng`        | mobile   | 破军                                                                                             |
| 界吴国太       | `re_wuguotai`       | mobile   | 甘露 / 补益                                                                                      |
| 界高顺         | `re_gaoshun`        | mobile   | 陷阵 / 禁酒                                                                                      |
| 界于禁         | `ol_yujin`          | mobile   | 节钺                                                                                             |
| 界曹植         | `re_caozhi`         | mobile   | 落英 / 酒诗 / 成章                                                                               |
| 界凌统         | **缺项**            | —        | 原生界凌统另有非主公技勇进及旋风背水效果，没有仅含目录旋风的完整原生版本。                       |
| 界钟会         | `re_zhonghui`       | mobile   | 权计 / 自立                                                                                      |
| 界公孙瓒       | `xin_gongsunzan`    | mobile   | 义从 / 趫猛                                                                                      |
| 郭皇后         | `guohuanghou`       | yijiang  | 矫诏 / 殚心                                                                                      |
| 李严           | `old_liyan`         | old      | 督粮 / 腹鳞                                                                                      |
| 孙登           | `sundeng`           | yijiang  | 匡弼                                                                                             |
| 刘虞           | `liuyu`             | yijiang  | 止戈 / 宗祚 / 崇望                                                                               |
| 岑昏           | `cenhun`            | yijiang  | 极奢 / 链祸                                                                                      |
| 孙资刘放       | `sunziliufang`      | yijiang  | 瑰藻 / 讥谀                                                                                      |
| 黄皓           | `huanghao`          | yijiang  | 寝情 / 贿生                                                                                      |
| 张让           | `zhangrang`         | yijiang  | 滔乱                                                                                             |
| 辛宪英         | **缺项**            | —        | 原生辛宪英忠鉴展示数量与才识的用牌限制不同。                                                     |
| 吴苋           | `wuxian`            | yijiang  | 福绵 / 怠宴                                                                                      |
| 徐氏           | `xushi`             | yijiang  | 问卦 / 伏诛                                                                                      |
| 曹节           | `caojie`            | yijiang  | 守玺 / 惠民                                                                                      |
| 秦宓           | `qinmi`             | yijiang  | 谏征 / 专对 / 天辩                                                                               |
| 蔡邕           | `caiyong`           | yijiang  | 辟撰 / 通博                                                                                      |
| 伏完           | **缺项**            | —        | 原生伏完谋溃允许同时执行两项，后续弃牌条件也不同。                                               |
| 刘协           | `liuxie`            | sp       | 天命 / 密诏 / 坠廷                                                                               |
| SP孙尚香       | `sp_sunshangxiang`  | sp       | 良助 / 返乡                                                                                      |
| 杨修           | **缺项**            | —        | 原生杨修啖酪的适用牌及鸡肋持续期限不同。                                                         |
| SP庞德         | `sp_pangde`         | sp       | 马术 / 决死                                                                                      |
| SP关羽         | `jsp_guanyu`        | sp       | 武圣 / 单骑                                                                                      |
| SP马超         | **缺项**            | —        | 原生SP马超誓仇的额外目标数量及追击附加效果不同。                                                 |
| SP赵云         | **缺项**            | —        | 原生SP赵云龙胆多出桃／酒转换，属于非主公技能差异。                                               |
| SP貂蝉         | **缺项**            | —        | 原生SP貂蝉闭月在空手时摸两张，目录版本为摸一张。                                                 |
| SP贾诩         | **缺项**            | —        | 原生SP贾诩间书的距离限制及拥嫡触发、回复效果不同。                                               |
| SP曹仁         | `sp_caoren`         | sp       | 伪溃 / 励战                                                                                      |
| SP蔡文姬       | `sp_caiwenji`       | sp       | 陈情 / 默识                                                                                      |
| 陈琳           | **缺项**            | —        | 原生陈琳颂词的手牌等于体力分支及额外奖励不同。                                                   |
| 曹洪           | `caohong`           | sp       | 援护                                                                                             |
| 夏侯霸         | `xiahouba`          | sp       | 豹变                                                                                             |
| 大乔小乔       | **缺项**            | —        | 原生大乔小乔星舞的花色条件、移除方式或伤害值不同。                                               |
| 诸葛恪         | **缺项**            | —        | 原生诸葛恪傲才增加空手看四张的效果，黩武的消耗与濒死结算条件也不同。                             |
| 张宝           | **缺项**            | —        | 原生张宝影兵按颜色判断并获得咒，目录版本按花色判断并移除咒。                                     |
| 乐进           | **缺项**            | —        | 原生乐进骁果可弃任意手牌且有额外摸牌效果，目录版本消耗基本牌。                                   |
| 曹昂           | `caoang`            | sp       | 慷忾                                                                                             |
| 诸葛瑾         | **缺项**            | —        | 原生诸葛瑾弘援／明哲的触发与效果已修改。                                                         |
| 张星彩         | `old_zhangxingcai`  | old      | 甚贤 / 枪舞                                                                                      |
| 祖茂           | `zumao`             | sp       | 引兵 / 绝地                                                                                      |
| 丁奉           | `old_dingfeng`      | old      | 奋迅 / 短兵                                                                                      |
| 马良           | `maliang`           | sp       | 自书 / 应援                                                                                      |
| 诸葛诞         | **缺项**            | —        | 原生诸葛诞举义的受伤条件和觉醒摸牌方式不同。                                                     |
| 程昱           | `mb_chengyu`        | mobile   | 设伏 / 贲育                                                                                      |
| 何太后         | **缺项**            | —        | 原生何太后鸩毒允许对自己发动，戚乱增加其他角色击杀的奖励。                                       |
| 李丰           | `lifeng`            | mobile   | 屯储 / 输粮                                                                                      |
| 朱灵           | `zhuling`           | mobile   | 战意                                                                                             |
| 孙鲁育         | `mb_sunluyu`        | mobile   | 魅步 / 穆穆                                                                                      |
| 文聘           | `wenpin`            | sp       | 镇卫                                                                                             |
| 孙皓           | **缺项**            | —        | 原生孙皓残蚀的摸牌方式及仇海的伤害范围不同。                                                     |
| SP姜维         | `sp_jiangwei`       | sp       | 困奋 / 逢亮                                                                                      |
| SP徐庶         | `re_xushu`          | refresh  | 诛害 / 潜心                                                                                      |
| 李典           | `old_re_lidian`     | standard | 恂恂 / 忘隙                                                                                      |
| 张鲁           | `zhanglu`           | sp       | 义舍 / 布施 / 米道 / 师君                                                                        |
| 士燮           | `old_shixie`        | old      | 避乱 / 礼下                                                                                      |
| 蹋顿           | **缺项**            | —        | 原生蹋顿乱战在受到伤害后也加标记，标记减少方式不同。                                             |
| 严白虎         | **缺项**            | —        | 虽已核对严白虎即原生严虎，原生雉盗的目标限制持续到回合末，目录版本持续到出牌阶段末。             |
| 关索           | `guansuo`           | sp       | 征南 / 撷芳                                                                                      |
| 王朗           | `old_wanglang`      | old      | 鼓舌 / 激词                                                                                      |
| 司马朗         | `simalang`          | sp       | 郡兵 / 去疾                                                                                      |
| SP黄月英       | **缺项**            | —        | 原生SP黄月英机巧可获得非装备牌，玲珑的空置装备栏效果也不同。                                     |
| 步骘           | **缺项**            | —        | 原生步骘定叛每阶段限一次，目录版本的上限为场上反贼数。                                           |
| 李通           | `litong`            | sp       | 推锋                                                                                             |
| 糜竺           | `mizhu`             | sp       | 资援 / 巨贾                                                                                      |
| 赵襄           | **缺项**            | —        | 原生赵襄芳魂的标记获取及扶汉的体力调整、回复方式不同。                                           |
| 马忠           | **缺项**            | —        | 原生马忠抚蛮可交任意手牌并有伤害后的额外摸牌，目录版本仅交杀。                                   |
| 阚泽           | `kanze`             | sp       | 下书 / 宽释                                                                                      |
| 王允           | `re_wangyun`        | mobile   | 连计 / 谋逞                                                                                      |
| 麹义           | **缺项**            | —        | 原生麴义伏骑限制所有牌的响应，目录版本只限制杀及锦囊的响应。                                     |
| 戏志才         | `xizhicai`          | sp       | 天妒 / 先辅 / 筹策                                                                               |
| 孙乾           | `sunqian`           | sp       | 谦雅 / 说盟                                                                                      |
| 刘焉           | `liuyan`            | sp       | 图射 / 立牧                                                                                      |
| 潘濬           | `panjun`            | sp       | 观微 / 公清                                                                                      |
| 赵统赵广       | `zhaotongzhaoguang` | mobile   | 翊赞 / 龙渊                                                                                      |
| 董允           | `dongyun`           | sp       | 秉正 / 舍宴                                                                                      |
| 吕虔           | **缺项**            | —        | 原生吕虔威虏的回复时机与赠刀的发动阶段不同。                                                     |
| sp庞统         | `re_jsp_pangtong`   | sp       | 过论 / 送丧                                                                                      |
| sp太史慈       | `sp_taishici`       | sp2      | 击虚                                                                                             |
| 鲁芝           | `luzhi`             | sp       | 清忠 / 卫境                                                                                      |
| 马云騄         | **缺项**            | —        | 原生马云騄凤魄的摸牌、伤害组合及触发限制不同。                                                   |
| 张梁           | **缺项**            | —        | 原生张梁集军可于整个回合触发，目录版本限定出牌阶段；其他候选的方统也不同。                       |
| 刘琦           | **缺项**            | —        | 原生刘琦问计按牌类别且持续回合，目录版本按同名牌且持续阶段。                                     |
| 李傕           | `lijue`             | sp2      | 狼袭 / 亦算                                                                                      |
| 郭汜           | **缺项**            | —        | 原生郭汜贪狈／伺盗的持续期限或阶段次数限制不同。                                                 |
| 徐荣           | **缺项**            | —        | 原生徐荣凶镬的标记上限、随机取牌与杀绝触发条件不同。                                             |
| SP司马昭       | `simazhao`          | mobile   | 怠攻 / 昭心                                                                                      |
| 王元姬         | **缺项**            | —        | 原生王元姬尚俭不计因使用装备而失去的牌，目录版本统计所有失去的牌。                               |
| 张济           | `zhangji`           | sp2      | 掠命 / 屯军                                                                                      |
| 樊稠           | **缺项**            | —        | 原生樊稠兴乱已增加选项、保底摸牌且目标条件不同。                                                 |
| 严畯           | **缺项**            | —        | 原生严畯逊贤可在自己回合发动，并增加体力值比较条件。                                             |
| 杜畿           | `duji`              | sp2      | 安东 / 应势                                                                                      |
| 卑弥呼         | `beimihu`           | sp2      | 纵傀 / 骨疽 / 拜假                                                                               |
| 吕岱           | **缺项**            | —        | 原生吕岱勤国没有目录中回合内使用装备的限制，回复的装备变动范围也不同。                           |
| 周鲂           | **缺项**            | —        | 原生周鲂断发按回合统计上限，目录版本按出牌阶段统计。                                             |
| 刘繇           | **缺项**            | —        | 原生刘繇戡难对拼点平局的处理及持续限制不同；不能只因额外逆拒是主公技而接纳。                     |
| 曹婴           | **缺项**            | —        | 原生曹婴凌人与伏间的触发、奖励和获得的关联技能均有非主公差异。                                   |
| 审配           | `shenpei`           | mobile   | 守邺 / 烈直                                                                                      |
| 张琪瑛         | **缺项**            | —        | 原生张琪瑛真仪的桃转换时机、增伤与点化的牌堆底选择不同。                                         |
| 沙摩柯         | `shamoke`           | sp       | 蒺藜                                                                                             |
| 胡金定         | `hujinding`         | mobile   | 仁释 / 武缘 / 怀子                                                                               |
| 许贡           | **缺项**            | —        | 原生许贡表召牌公开放置，目录为扣置；其他原生候选的点数条件与奖励也不同。                         |
| 张恭           | `re_zhanggong`      | mobile   | 遣信 / 镇行                                                                                      |
| 吕凯           | **缺项**            | —        | 原生吕凯闭境最多两张且准备阶段重铸，目录为一张并弃置。                                           |
| 卫温诸葛直     | `re_weiwenzhugezhi` | mobile   | 浮海                                                                                             |
| 张翼           | `zhangyì`           | mobile   | 执义                                                                                             |
| 贾逵           | `jiakui`            | mobile   | 通渠 / 挽澜                                                                                      |
| 董承           | `dongcheng`         | mobile   | 承诏                                                                                             |
| 杨仪           | **缺项**            | —        | 原生杨仪度断的不可响应范围及共损作用区域与目录版本不同。                                         |
| 邓芝           | `dengzhi`           | mobile   | 急盟 / 率言                                                                                      |
| 苏飞           | `sp_sufei`          | mobile   | 诤荐 / 告援                                                                                      |
| 诸葛果         | `mb_zhugeguo`       | mobile   | 祈禳 / 羽化                                                                                      |
| 陶谦           | `taoqian`           | mobile   | 招祸 / 义襄 / 揖让                                                                               |
| 刘晔           | `liuye`             | mobile   | 破橹 / 筹略                                                                                      |
| 司马徽         | **缺项**            | —        | 原生司马徽称好观看数量与荐杰的发动时机、次数限制不同。                                           |
| 神吕蒙         | `shen_lvmeng`       | extra    | 涉猎 / 攻心                                                                                      |
| 神周瑜         | **缺项**            | —        | 原生神周瑜琴音统计弃牌阶段弃置的所有牌，目录只统计手牌，非主公效果不同。                         |
| 神诸葛亮       | `shen_zhugeliang`   | extra    | 七星 / 狂风 / 大雾                                                                               |
| 神曹操         | `mb_shen_caocao`    | mobile   | 归心 / 飞影                                                                                      |
| 神赵云         | `shen_zhaoyun`      | extra    | 绝境 / 龙魂                                                                                      |
| 神刘备         | **缺项**            | —        | 原生神刘备龙怒的摸牌数及结营的额外摸牌不同。                                                     |
| 神陆逊         | `shen_luxun`        | extra    | 军略 / 摧克 / 绽火                                                                               |
| 神张辽         | **缺项**            | —        | 原生神张辽夺锐允许废除宝物栏并在全部废除后跳过消耗，与目录版本不同。                             |
| 神甘宁         | `shen_ganning`      | extra    | 魄袭 / 劫营                                                                                      |
| 孙茹           | `sunru`             | mobile   | 影箭 / 释衅                                                                                      |
| 凌操           | **缺项**            | —        | 原生凌操独进对装备数的一半向上取整，目录版本向下取整。                                           |
| 留赞           | `liuzan`            | mobile   | 奋音                                                                                             |
| 马钧           | `majun`             | mobile   | 精械 / 巧思                                                                                      |
| 郑玄           | **缺项**            | —        | 原生郑玄整经没有目录中每个出牌阶段限一次的限制。                                                 |
| 星张辽         | `yj_zhangliao`      | newjiang | 威风                                                                                             |
| 星甘宁         | **缺项**            | —        | 原生星甘宁锦帆仅在铃移至处理区时补牌，目录版本在铃离开武将牌时补牌。                             |
| 祢衡           | `miheng`            | mobile   | 狂才 / 舌剑                                                                                      |
| 庞德公         | `pangdegong`        | mobile   | 评才 / 隐世                                                                                      |

- 刘备 → `liubei`：保留完整原生主公技激将及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 孙权 → `sunquan`：保留完整原生主公技救援及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 曹操 → `caocao`：保留完整原生主公技护驾及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 甄姬 → `zhenji`：目录甄姬对应原生甄宓（zhenji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 黄忠 → `huangzhong`：目录黄忠对应原生旧黄忠（huangzhong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 魏延 → `weiyan`：目录魏延对应原生旧魏延（weiyan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 夏侯渊 → `xiahouyuan`：目录夏侯渊对应原生旧夏侯渊（xiahouyuan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 小乔 → `old_xiaoqiao`：目录小乔对应原生旧小乔（old_xiaoqiao），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 张角 → `zhangjiao`：目录张角对应原生旧张角（zhangjiao），按非主公技能核对，不要求名称一致。保留完整原生主公技黄天及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 于吉 → `yuji`：目录于吉对应原生旧于吉（yuji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 卧龙诸葛 → `sp_zhugeliang`：目录卧龙诸葛对应原生卧龙（sp_zhugeliang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 庞德 → `pangde`：目录庞德对应原生旧庞德（pangde），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 袁绍 → `re_yuanshao`：保留完整原生主公技血裔及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 徐晃 → `xuhuang`：目录徐晃对应原生旧徐晃（xuhuang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 曹丕 → `caopi`：保留完整原生主公技颂威及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 董卓 → `dongzhuo`：保留完整原生主公技暴虐及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 刘禅 → `liushan`：保留完整原生主公技若愚及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 蔡文姬 → `caiwenji`：目录蔡文姬对应原生蔡琰（caiwenji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 孙亮 → `xin_sunliang`：目录孙亮对应原生手杀孙亮（xin_sunliang），按非主公技能核对，不要求名称一致。保留完整原生主公技立军及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 蒯越蒯良 → `kuailiangkuaiyue`：目录蒯越蒯良对应原生蒯良蒯越（kuailiangkuaiyue），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 毌丘俭 → `re_guanqiujian`：目录毌丘俭对应原生手杀毌丘俭（re_guanqiujian），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 陈到 → `old_chendao`：目录陈到对应原生旧陈到（old_chendao），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 张绣 → `zhangxiu`：保留完整原生主公技踞襄及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 仲帝袁术 → `yl_yuanshu`：目录仲帝袁术对应原生新杀袁术（yl_yuanshu），按非主公技能核对，不要求名称一致。保留完整原生主公技伪帝及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界袁术 → `old_yuanshu`：目录界袁术对应原生手杀袁术（old_yuanshu），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界华雄 → `ol_huaxiong`：目录界华雄对应原生旧华雄（ol_huaxiong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界周泰 → `xin_zhoutai`：目录界周泰对应原生手杀界周泰（xin_zhoutai），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界于吉 → `re_yuji`：目录界于吉对应原生于吉（re_yuji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界张角 → `sp_zhangjiao`：目录界张角对应原生张角（sp_zhangjiao），按非主公技能核对，不要求名称一致。保留完整原生主公技黄天及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界刘备 → `re_liubei`：保留完整原生主公技激将及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界张飞 → `xin_zhangfei`：目录界张飞对应原生手杀界张飞（xin_zhangfei），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界赵云 → `old_zhaoyun`：目录界赵云对应原生新杀赵云（old_zhaoyun），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界曹操 → `re_caocao`：保留完整原生主公技护驾及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界夏侯惇 → `xin_xiahoudun`：目录界夏侯惇对应原生手杀界夏侯惇（xin_xiahoudun），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界孙权 → `re_sunquan`：保留完整原生主公技救援及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界甄姬 → `re_zhenji`：目录界甄姬对应原生界甄宓（re_zhenji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界伊籍 → `xf_yiji`：目录界伊籍对应原生伊籍（xf_yiji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界卧龙诸葛 → `re_sp_zhugeliang`：目录界卧龙诸葛对应原生手杀界卧龙（re_sp_zhugeliang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界典韦 → `re_dianwei`：目录界典韦对应原生手杀界典韦（re_dianwei），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界荀彧 → `re_xunyu`：目录界荀彧对应原生手杀界荀彧（re_xunyu），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界庞德 → `re_pangde`：目录界庞德对应原生庞德（re_pangde），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界庞统 → `re_pangtong`：目录界庞统对应原生手杀界庞统（re_pangtong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界颜良文丑 → `re_yanwen`：目录界颜良文丑对应原生手杀界颜良文丑（re_yanwen），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界袁绍 → `xin_yuanshao`：目录界袁绍对应原生手杀界袁绍（xin_yuanshao），按非主公技能核对，不要求名称一致。保留完整原生主公技血裔及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界徐晃 → `re_xuhuang`：目录界徐晃对应原生徐晃（re_xuhuang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界孟获 → `re_menghuo`：保留完整原生主公技酋首及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界祝融 → `re_zhurong`：目录界祝融对应原生手杀界祝融（re_zhurong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界曹丕 → `re_caopi`：保留完整原生主公技颂威及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界孙坚 → `re_sunjian`：目录界孙坚对应原生手杀界孙坚（re_sunjian），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界董卓 → `re_dongzhuo`：目录界董卓对应原生手杀界董卓（re_dongzhuo），按非主公技能核对，不要求名称一致。保留完整原生主公技暴虐及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界邓艾 → `re_dengai`：目录界邓艾对应原生手杀界邓艾（re_dengai），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界姜维 → `re_jiangwei`：目录界姜维对应原生手杀界姜维（re_jiangwei），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界蔡文姬 → `re_caiwenji`：目录界蔡文姬对应原生手杀界蔡琰（re_caiwenji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界张昭张纮 → `re_zhangzhang`：目录界张昭张纮对应原生手杀界张昭张纮（re_zhangzhang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界刘禅 → `re_liushan`：目录界刘禅对应原生手杀界刘禅（re_liushan），按非主公技能核对，不要求名称一致。保留完整原生主公技若愚及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 界黄忠 → `re_huangzhong`：目录界黄忠对应原生黄忠（re_huangzhong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界魏延 → `re_weiyan`：目录界魏延对应原生魏延（re_weiyan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界夏侯渊 → `re_xiahouyuan`：目录界夏侯渊对应原生夏侯渊（re_xiahouyuan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界小乔 → `re_xiaoqiao`：目录界小乔对应原生手杀界小乔（re_xiaoqiao），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 法正 → `fazheng`：目录法正对应原生旧法正（fazheng），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 王异 → `old_wangyi`：目录王异对应原生旧王异（old_wangyi），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 关兴张苞 → `old_guanzhang`：目录关兴张苞对应原生旧关兴张苞（old_guanzhang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 伏皇后 → `fuhuanghou`：目录伏皇后对应原生伏寿（fuhuanghou），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 马岱 → `madai`：目录马岱对应原生旧马岱（madai），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 公孙瓒 → `re_gongsunzan`：目录公孙瓒对应原生界公孙瓒（re_gongsunzan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 曹真 → `old_caozhen`：目录曹真对应原生旧曹真（old_caozhen），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 陈群 → `old_chenqun`：目录陈群对应原生旧陈群（old_chenqun），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 吴懿 → `old_wuyi`：目录吴懿对应原生旧吴懿（old_wuyi），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 曹叡 → `caorui`：保留完整原生主公技兴衰及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 钟繇 → `mb_zhongyao`：目录钟繇对应原生手杀钟繇（mb_zhongyao），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 刘谌 → `liuchen`：保留完整原生主公技勤王及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 孙休 → `sunxiu`：保留完整原生主公技诏缚及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 朱治 → `old_zhuzhi`：目录朱治对应原生旧朱治（old_zhuzhi），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界马岱 → `old_madai`：目录界马岱对应原生马岱（old_madai），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界法正 → `xin_fazheng`：目录界法正对应原生法正（xin_fazheng），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界关兴张苞 → `guanzhang`：目录界关兴张苞对应原生关兴张苞（guanzhang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界徐盛 → `re_xusheng`：目录界徐盛对应原生手杀界徐盛（re_xusheng），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界吴国太 → `re_wuguotai`：目录界吴国太对应原生手杀界吴国太（re_wuguotai），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界高顺 → `re_gaoshun`：目录界高顺对应原生手杀界高顺（re_gaoshun），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界于禁 → `ol_yujin`：目录界于禁对应原生手杀界于禁（ol_yujin），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界曹植 → `re_caozhi`：目录界曹植对应原生手杀界曹植（re_caozhi），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界钟会 → `re_zhonghui`：目录界钟会对应原生手杀界钟会（re_zhonghui），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 界公孙瓒 → `xin_gongsunzan`：目录界公孙瓒对应原生手杀界公孙瓒（xin_gongsunzan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 李严 → `old_liyan`：目录李严对应原生旧李严（old_liyan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 刘虞 → `liuyu`：保留完整原生主公技崇望及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 刘协 → `liuxie`：保留完整原生主公技坠廷及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- SP蔡文姬 → `sp_caiwenji`：目录SP蔡文姬对应原生SP蔡琰（sp_caiwenji），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 张星彩 → `old_zhangxingcai`：目录张星彩对应原生旧张星彩（old_zhangxingcai），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 丁奉 → `old_dingfeng`：目录丁奉对应原生旧丁奉（old_dingfeng），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 程昱 → `mb_chengyu`：目录程昱对应原生手杀程昱（mb_chengyu），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 李丰 → `lifeng`：目录李丰对应原生手杀李丰（lifeng），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 孙鲁育 → `mb_sunluyu`：目录孙鲁育对应原生手杀孙鲁育（mb_sunluyu），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- SP徐庶 → `re_xushu`：目录SP徐庶对应原生界徐庶（re_xushu），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 张鲁 → `zhanglu`：保留完整原生主公技师君及主公标记，按原生规则生效。 [版本依据](https://www.sanguosha.cn/)
- 士燮 → `old_shixie`：目录士燮对应原生旧士燮（old_shixie），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 王朗 → `old_wanglang`：目录王朗对应原生旧王朗（old_wanglang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 阚泽 → `kanze`：目录阚泽对应原生OL阚泽（kanze），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 王允 → `re_wangyun`：目录王允对应原生手杀王允（re_wangyun），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 赵统赵广 → `zhaotongzhaoguang`：目录赵统赵广对应原生手杀赵统赵广（zhaotongzhaoguang），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- sp庞统 → `re_jsp_pangtong`：目录sp庞统对应原生SP庞统（re_jsp_pangtong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- sp太史慈 → `sp_taishici`：目录sp太史慈对应原生SP太史慈（sp_taishici），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 胡金定 → `hujinding`：目录胡金定对应原生手杀胡金定（hujinding），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 张恭 → `re_zhanggong`：目录张恭对应原生手杀张恭（re_zhanggong），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 卫温诸葛直 → `re_weiwenzhugezhi`：目录卫温诸葛直对应原生手杀卫温诸葛直（re_weiwenzhugezhi），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 董承 → `dongcheng`：目录董承对应原生手杀董承（dongcheng），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 邓芝 → `dengzhi`：目录邓芝对应原生手杀邓芝（dengzhi），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 苏飞 → `sp_sufei`：目录苏飞对应原生手杀苏飞（sp_sufei），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 诸葛果 → `mb_zhugeguo`：目录诸葛果对应原生手杀诸葛果（mb_zhugeguo），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 陶谦 → `taoqian`：目录陶谦对应原生手杀陶谦（taoqian），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 刘晔 → `liuye`：目录刘晔对应原生手杀刘晔（liuye），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 神曹操 → `mb_shen_caocao`：目录神曹操对应原生手杀神曹操（mb_shen_caocao），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 孙茹 → `sunru`：目录孙茹对应原生手杀孙茹（sunru），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 留赞 → `liuzan`：目录留赞对应原生手杀留赞（liuzan），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 马钧 → `majun`：目录马钧对应原生手杀马钧（majun），按非主公技能核对，不要求名称一致。技能中的限时／小游戏使用固定无名杀原生实现，未移植商业客户端交互。 [版本依据](https://www.sanguosha.cn/)
- 星张辽 → `yj_zhangliao`：目录星张辽对应原生☆张辽（yj_zhangliao），按非主公技能核对，不要求名称一致。 [版本依据](https://www.sanguosha.cn/)
- 祢衡 → `miheng`：目录祢衡对应原生手杀祢衡（miheng），按非主公技能核对，不要求名称一致。技能中的限时／小游戏使用固定无名杀原生实现，未移植商业客户端交互。 [版本依据](https://www.sanguosha.cn/)
- 庞德公 → `pangdegong`：目录庞德公对应原生手杀庞德公（pangdegong），按非主公技能核对，不要求名称一致。技能中的限时／小游戏使用固定无名杀原生实现，未移植商业客户端交互。 [版本依据](https://www.sanguosha.cn/)
- 典韦：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_dianwei`、`dianwei`、`ol_dianwei`。
- 孟获：[平台技能依据](https://www.sanguosha.cn/)；排除 `menghuo`、`re_menghuo`、`ol_le_menghuo`。
- 姜维：[平台技能依据](https://www.sanguosha.cn/)；排除 `jiangwei`、`ol_jiangwei`、`re_jiangwei`。
- 孙策：[平台技能依据](https://www.sanguosha.cn/)；排除 `sunce`、`re_sunce`、`sp_sunce`。
- 许攸：[平台技能依据](https://www.sanguosha.cn/)；排除 `junk_xuyou`、`xuyou`、`sp_xuyou`。
- 卢植：[平台技能依据](https://www.sanguosha.cn/)；排除 `yl_luzhi`、`tw_yl_luzhi`。
- 周妃：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_zhoufei`、`zhoufei`、`yue_zhoufei`。
- 陆抗：[平台技能依据](https://www.sanguosha.cn/)；排除 `lukang`。
- 界马超：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_machao`、`machao`、`sp_machao`。
- 界吕蒙：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_lvmeng`、`lvmeng`、`ns_lvmeng`。
- 界孙策：[平台技能依据](https://www.sanguosha.cn/)；排除 `sunce`、`re_sunce`、`sp_sunce`。
- 高顺：[平台技能依据](https://www.sanguosha.cn/)；排除 `old_gaoshun`、`gaoshun`、`ol_gaoshun`。
- 马谡：[平台技能依据](https://www.sanguosha.cn/)；排除 `xin_masu`、`re_masu`、`ns_masu`。
- 于禁：[平台技能依据](https://www.sanguosha.cn/)；排除 `ol_yujin`、`yujin`、`ol_re_yujin`。
- 曹彰：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_caozhang`、`xin_caozhang`、`caozhang`。
- 步练师：[平台技能依据](https://www.sanguosha.cn/)；排除 `bulianshi`、`re_bulianshi`、`dc_bulianshi`。
- 刘表：[平台技能依据](https://www.sanguosha.cn/)；排除 `liubiao`、`re_liubiao`、`std_liubiao`。
- 郭淮：[平台技能依据](https://www.sanguosha.cn/)；排除 `xin_guohuai`、`guohuai`、`ol_guohuai`。
- 周仓：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhoucang`、`re_zhoucang`、`xin_zhoucang`。
- 顾雍：[平台技能依据](https://www.sanguosha.cn/)；排除 `guyong`、`xin_guyong`、`re_guyong`。
- 界凌统：[平台技能依据](https://www.sanguosha.cn/)；排除 `lingtong`、`ol_lingtong`、`old_lingtong`。
- 辛宪英：[平台技能依据](https://www.sanguosha.cn/)；排除 `xinxianying`、`ol_re_xinxianying`、`re_xinxianying`。
- 伏完：[平台技能依据](https://www.sanguosha.cn/)；排除 `fuwan`、`tw_fuwan`、`sp_fuwan`。
- 杨修：[平台技能依据](https://www.sanguosha.cn/)；排除 `yangxiu`、`clan_yangxiu`。
- SP马超：[平台技能依据](https://www.sanguosha.cn/)；排除 `sp_machao`、`dc_sp_machao`、`re_machao`。
- SP赵云：[平台技能依据](https://www.sanguosha.cn/)；排除 `sp_zhaoyun`、`re_zhaoyun`、`old_zhaoyun`。
- SP貂蝉：[平台技能依据](https://www.sanguosha.cn/)；排除 `sp_diaochan`、`diaochan`、`re_diaochan`。
- SP贾诩：[平台技能依据](https://www.sanguosha.cn/)；排除 `sp_jiaxu`、`dc_sp_jiaxu`、`re_jiaxu`。
- 陈琳：[平台技能依据](https://www.sanguosha.cn/)；排除 `chenlin`。
- 大乔小乔：[平台技能依据](https://www.sanguosha.cn/)；排除 `dc_daxiaoqiao`、`daxiaoqiao`、`tw_daxiaoqiao`。
- 诸葛恪：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhugeke`、`std_zhugeke`。
- 张宝：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhangbao`、`re_zhangbao`、`ns_zhangbao`。
- 乐进：[平台技能依据](https://www.sanguosha.cn/)；排除 `yuejin`、`std_yuejin`。
- 诸葛瑾：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhugejin`、`star_zhugejin`。
- 诸葛诞：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhugedan`、`re_zhugedan`。
- 何太后：[平台技能依据](https://www.sanguosha.cn/)；排除 `hetaihou`。
- 孙皓：[平台技能依据](https://www.sanguosha.cn/)；排除 `sunhao`、`std_sunhao`。
- 蹋顿：[平台技能依据](https://www.sanguosha.cn/)；排除 `tadun`。
- 严白虎：[平台技能依据](https://www.sanguosha.cn/)；排除 `yanbaihu`。
- SP黄月英：[平台技能依据](https://www.sanguosha.cn/)；排除 `jsp_huangyueying`、`re_jsp_huangyueying`、`junk_huangyueying`。
- 步骘：[平台技能依据](https://www.sanguosha.cn/)；排除 `buzhi`。
- 赵襄：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhaoxiang`、`dc_zhaoxiang`、`tw_zhaoxiang`。
- 马忠：[平台技能依据](https://www.sanguosha.cn/)；排除 `mazhong`、`tw_mazhong`、`re_mazhong`。
- 麹义：[平台技能依据](https://www.sanguosha.cn/)；排除 `quyi`、`re_quyi`、`std_quyi`。
- 吕虔：[平台技能依据](https://www.sanguosha.cn/)；排除 `lvqian`。
- 马云騄：[平台技能依据](https://www.sanguosha.cn/)；排除 `mayunlu`、`tw_mayunlu`、`std_mayunlu`。
- 张梁：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_zhangliang`、`xin_zhangliang`、`zhangliang`。
- 刘琦：[平台技能依据](https://www.sanguosha.cn/)；排除 `sp_liuqi`。
- 郭汜：[平台技能依据](https://www.sanguosha.cn/)；排除 `guosi`。
- 徐荣：[平台技能依据](https://www.sanguosha.cn/)；排除 `xurong`。
- 王元姬：[平台技能依据](https://www.sanguosha.cn/)；排除 `wangyuanji`、`std_wangyuanji`、`sp_wangyuanji`。
- 樊稠：[平台技能依据](https://www.sanguosha.cn/)；排除 `fanchou`、`tw_fanchou`、`ns_fanchou`。
- 严畯：[平台技能依据](https://www.sanguosha.cn/)；排除 `yanjun`。
- 吕岱：[平台技能依据](https://www.sanguosha.cn/)；排除 `lvdai`。
- 周鲂：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhoufang`、`std_zhoufang`。
- 刘繇：[平台技能依据](https://www.sanguosha.cn/)；排除 `liuyao`。
- 曹婴：[平台技能依据](https://www.sanguosha.cn/)；排除 `caoying`。
- 张琪瑛：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhangqiying`、`y_dc_zhangqiying`。
- 许贡：[平台技能依据](https://www.sanguosha.cn/)；排除 `re_xugong`、`xugong`。
- 吕凯：[平台技能依据](https://www.sanguosha.cn/)；排除 `lvkai`。
- 杨仪：[平台技能依据](https://www.sanguosha.cn/)；排除 `yangyi`、`tw_yangyi`、`ns_yangyi`。
- 司马徽：[平台技能依据](https://www.sanguosha.cn/)；排除 `simahui`、`std_simahui`。
- 神周瑜：[平台技能依据](https://www.sanguosha.cn/)；排除 `shen_zhouyu`。
- 神刘备：[平台技能依据](https://www.sanguosha.cn/)；排除 `shen_liubei`。
- 神张辽：[平台技能依据](https://www.sanguosha.cn/)；排除 `shen_zhangliao`、`ol_zhangliao`、`dc_shen_zhangliao`。
- 凌操：[平台技能依据](https://www.sanguosha.cn/)；排除 `lingcao`、`dc_lingcao`。
- 郑玄：[平台技能依据](https://www.sanguosha.cn/)；排除 `zhengxuan`、`std_zhengxuan`。
- 星甘宁：[平台技能依据](https://www.sanguosha.cn/)；排除 `yj_ganning`、`sp_ganning`、`re_ganning`。
