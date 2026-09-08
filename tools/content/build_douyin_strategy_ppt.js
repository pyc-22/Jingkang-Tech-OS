const path = require('path');
const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Codex';
pptx.subject = '服务业门店增长与按摩店加盟抖音账号方案';
pptx.title = '抖音账号增长与转化执行方案';
pptx.company = '内部战略资料';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  lang: 'zh-CN'
};
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'CUSTOM_WIDE';
pptx.defineSlideMaster({
  title: 'MASTER',
  background: { color: 'F6F6F2' },
  objects: [
    { line: { x: 0.55, y: 7.07, w: 12.23, h: 0, line: { color: 'D6D9D5', width: 0.7 } } },
    { text: { text: '服务业门店增长 | 抖音内容与转化执行方案', options: { x: 0.58, y: 7.15, w: 5.4, h: 0.17, fontFace: 'Microsoft YaHei', fontSize: 5.8, color: '7B817E', margin: 0 } } }
  ],
  slideNumber: { x: 12.3, y: 7.12, color: '7B817E', fontFace: 'Arial', fontSize: 6 }
});

const C = {
  ink: '172422', muted: '62716E', green: '0B7A69', mint: 'CBE8DE', coral: 'E76F51', orange: 'F4B860', paper: 'F6F6F2', white: 'FFFFFF', line: 'D6D9D5', pale: 'E8EFEC', charcoal: '24312F', redPale: 'F9E4DD'
};
const S = { W: 13.333, H: 7.5 };

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: opts.fontFace || 'Microsoft YaHei',
    fontSize: opts.fontSize || 12,
    color: opts.color || C.ink,
    bold: opts.bold || false,
    breakLine: false,
    margin: opts.margin === undefined ? 0 : opts.margin,
    valign: opts.valign || 'mid',
    align: opts.align || 'left',
    fit: 'shrink',
    paraSpaceAfterPt: opts.paraSpaceAfterPt || 0,
    bullet: opts.bullet,
    isTextBox: true,
    ...opts
  });
}

function box(slide, x, y, w, h, fill = C.white, line = C.line, radius = 0.08) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: radius, fill: { color: fill }, line: { color: line, width: 0.6 } });
}

function pill(slide, label, x, y, w, fill, color = C.white) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.32, rectRadius: 0.16, fill: { color: fill }, line: { color: fill } });
  addText(slide, label, x, y + 0.015, w, 0.26, { fontSize: 7.4, color, bold: true, align: 'center' });
}

function title(slide, kicker, headline, sub) {
  addText(slide, kicker, 0.62, 0.42, 4.5, 0.24, { fontSize: 8, bold: true, color: C.green, charSpacing: 1.2 });
  addText(slide, headline, 0.62, 0.72, 12.0, 0.56, { fontSize: 23, bold: true, color: C.ink });
  if (sub) addText(slide, sub, 0.64, 1.35, 11.9, 0.34, { fontSize: 9.5, color: C.muted });
}

function sectionLabel(slide, text, x, y, color = C.green) {
  addText(slide, text, x, y, 3.2, 0.22, { fontSize: 7.2, bold: true, color, charSpacing: 0.8 });
}

function bulletList(slide, items, x, y, w, h, opts = {}) {
  const runs = [];
  items.forEach((item, i) => {
    runs.push({ text: item, options: { bullet: { indent: 12 }, hanging: 3, breakLine: i !== items.length - 1 } });
  });
  slide.addText(runs, { x, y, w, h, fontFace: 'Microsoft YaHei', fontSize: opts.fontSize || 9.4, color: opts.color || C.ink, margin: 0.02, breakLine: false, paraSpaceAfterPt: opts.paraSpaceAfterPt || 7, breakLine: false, fit: 'shrink', valign: 'top' });
}

function metric(slide, number, label, x, y, w, accent = C.green) {
  addText(slide, number, x, y, w, 0.35, { fontSize: 20, color: accent, bold: true });
  addText(slide, label, x, y + 0.38, w, 0.22, { fontSize: 8.4, color: C.muted });
}

// 1. Cover
{
  const s = pptx.addSlide('MASTER');
  s.background = { color: C.charcoal };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: S.W, h: S.H, fill: { color: C.charcoal }, line: { color: C.charcoal } });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: S.H, fill: { color: C.coral }, line: { color: C.coral } });
  s.addShape(pptx.ShapeType.arc, { x: 8.9, y: -1.1, w: 5.4, h: 5.4, adjustPoint: 0.2, line: { color: '4C655F', width: 1.2 }, fill: { color: C.charcoal, transparency: 100 } });
  s.addShape(pptx.ShapeType.arc, { x: 9.6, y: -0.4, w: 4.0, h: 4.0, adjustPoint: 0.2, line: { color: C.green, width: 1.2 }, fill: { color: C.charcoal, transparency: 100 } });
  pill(s, '内部战略与执行手册', 0.78, 1.03, 1.55, C.green);
  addText(s, '抖音账号增长\n与转化执行方案', 0.78, 1.68, 7.4, 1.45, { fontSize: 31, bold: true, color: C.white, breakLine: true, valign: 'top' });
  addText(s, '用“服务业门店增长实战”建立信任，\n以自营按摩店验证模型，承接代运营、加盟与城市合作。', 0.8, 3.45, 6.5, 0.75, { fontSize: 12, color: 'DDE9E5', breakLine: true, valign: 'top', breakLine: true });
  s.addShape(pptx.ShapeType.line, { x: 0.8, y: 5.38, w: 5.8, h: 0, line: { color: '6C837D', width: 0.7 } });
  addText(s, '适用对象：运营负责人 / 内容团队 / 门店负责人 / 招商负责人', 0.8, 5.58, 7.2, 0.26, { fontSize: 8.6, color: 'B9CCC6' });
  addText(s, '2026.07', 0.8, 6.55, 1.4, 0.22, { fontSize: 8, color: '8CA39D' });
}

// 2. Executive conclusion
{
  const s = pptx.addSlide('MASTER');
  title(s, '01 / 战略结论', '先建立专业信任，再把自营门店变成最有力的证明', '不要把目标定为“等爆款后招商”；目标应是持续筛出精准老板，验证内容和成交链路。');
  box(s, 0.62, 2.05, 3.9, 3.9, C.white);
  pill(s, '账号核心定位', 0.9, 2.35, 1.15, C.green);
  addText(s, '服务业门店\n增长实战', 0.9, 2.87, 2.8, 0.75, { fontSize: 22, bold: true, color: C.ink, breakLine: true, valign: 'top' });
  addText(s, '公开真实经营方法、案例与数据逻辑。\n让老板知道：你们能把流量变成利润。', 0.9, 3.9, 3.15, 0.58, { fontSize: 9.6, color: C.muted, breakLine: true, valign: 'top' });
  addText(s, '不是“代运营知识号”，而是\n“懂经营、能落地的操盘者”。', 0.9, 4.88, 3.05, 0.46, { fontSize: 10.2, color: C.green, bold: true, breakLine: true, valign: 'top' });
  const cards = [
    ['内容', '痛点 + 方法 + 案例', '吸引门店老板'],
    ['证明', '自营店经营过程', '建立可信度'],
    ['转化', '诊断 / 陪跑 / 合作', '区分业务线']
  ];
  cards.forEach((c, i) => {
    const x = 4.85 + i * 2.55;
    box(s, x, 2.28, 2.25, 2.98, i === 1 ? 'E4F2EC' : C.white, i === 1 ? C.mint : C.line);
    addText(s, `0${i + 1}`, x + 0.25, 2.57, 0.6, 0.3, { fontSize: 10, bold: true, color: C.coral });
    addText(s, c[0], x + 0.25, 3.1, 1.5, 0.33, { fontSize: 15, bold: true });
    addText(s, c[1], x + 0.25, 3.7, 1.75, 0.28, { fontSize: 9.4, color: C.ink, bold: true });
    addText(s, c[2], x + 0.25, 4.25, 1.7, 0.23, { fontSize: 8.5, color: C.muted });
    if (i < 2) s.addShape(pptx.ShapeType.chevron, { x: x + 2.3, y: 3.56, w: 0.28, h: 0.35, fill: { color: C.green }, line: { color: C.green } });
  });
  box(s, 4.85, 5.57, 7.35, 0.62, 'F9E4DD', 'F0C5B6');
  addText(s, '关键判断：播放量只能验证选题；有效私信、诊断预约和成交，才能验证生意。', 5.12, 5.75, 6.8, 0.23, { fontSize: 10.3, color: '9D3F2B', bold: true });
}

// 3. Audience and routes
{
  const s = pptx.addSlide('MASTER');
  title(s, '02 / 生意结构', '一个主账号，三条清晰业务承接路径', '前期用同一内容资产建立信任；后期加盟咨询稳定后，再独立开招商承接账号。');
  const routes = [
    { n: '存量门店老板', tag: '代运营 / 陪跑', c: C.green, q: '门店有客少、客单低、复购差等现实问题', a: '免费初诊 -> 付费诊断 -> 陪跑/代运营' },
    { n: '开店意向人群', tag: '加盟', c: C.coral, q: '有资金、场地或明确的开按摩店意愿', a: '模型介绍 -> 匹配筛选 -> 考察/签约' },
    { n: '本地资源方', tag: '城市合伙人', c: 'D49432', q: '有城市资源、团队或运营能力，愿意长期投入', a: '资源评估 -> 联营试点 -> 区域合作' }
  ];
  routes.forEach((r, i) => {
    const x = 0.7 + i * 4.17;
    box(s, x, 2.15, 3.72, 3.55, C.white);
    pill(s, r.tag, x + 0.28, 2.47, 1.3, r.c);
    addText(s, r.n, x + 0.28, 3.06, 2.9, 0.3, { fontSize: 15, bold: true });
    s.addShape(pptx.ShapeType.line, { x: x + 0.28, y: 3.56, w: 3.15, h: 0, line: { color: C.line, width: 0.7 } });
    addText(s, r.q, x + 0.28, 3.8, 3.0, 0.55, { fontSize: 9, color: C.muted, valign: 'top' });
    addText(s, '承接动作', x + 0.28, 4.63, 1.0, 0.21, { fontSize: 7.3, color: r.c, bold: true });
    addText(s, r.a, x + 0.28, 4.96, 3.02, 0.38, { fontSize: 9.1, bold: true, valign: 'top' });
  });
  addText(s, '原则：不同人群不共用同一套私信话术、资料包和成交流程。', 0.75, 6.15, 8.3, 0.27, { fontSize: 10, color: C.ink, bold: true });
}

// 4. 90 day roadmap
{
  const s = pptx.addSlide('MASTER');
  title(s, '03 / 90 天路线图', '用三段式推进，不依赖一条“爆款”决定方向', '每 2 周复盘一次，用数据决定选题加码、表达调整和招商露出比例。');
  const phases = [
    ['第 1-2 周', '定位与测试', '发布 7-10 条\n测试痛点、案例、避坑三类内容', C.green],
    ['第 3-8 周', '内容与线索验证', '累计 30-50 条\n跑出高咨询选题和诊断转化流程', C.coral],
    ['第 9-12 周', '模型证明与合作承接', '持续公开自营店数据\n分批测试加盟/城市合作需求', 'D49432']
  ];
  s.addShape(pptx.ShapeType.line, { x: 1.2, y: 3.1, w: 10.9, h: 0, line: { color: C.line, width: 2 } });
  phases.forEach((p, i) => {
    const x = 1.17 + i * 4.0;
    s.addShape(pptx.ShapeType.ellipse, { x, y: 2.82, w: 0.56, h: 0.56, fill: { color: p[3] }, line: { color: p[3] } });
    addText(s, String(i + 1), x, 2.92, 0.56, 0.16, { fontSize: 9, bold: true, color: C.white, align: 'center' });
    box(s, x - 0.28, 3.65, 3.45, 1.75, C.white);
    addText(s, p[0], x, 3.93, 1.4, 0.2, { fontSize: 8.5, color: p[3], bold: true });
    addText(s, p[1], x, 4.26, 2.9, 0.28, { fontSize: 13.2, bold: true });
    addText(s, p[2], x, 4.75, 2.9, 0.42, { fontSize: 8.6, color: C.muted, breakLine: true, valign: 'top' });
  });
  box(s, 0.72, 5.94, 11.8, 0.55, 'E4F2EC', C.mint);
  addText(s, '复盘逻辑：保留能带来精准评论/私信的内容 -> 拆成系列 -> 优化首 3 秒、案例细节和行动引导。', 0.95, 6.11, 11.2, 0.2, { fontSize: 9.5, color: C.green, bold: true });
}

// 5. Phase 1
{
  const s = pptx.addSlide('MASTER');
  title(s, '04 / 第一阶段', '前 30 天：先验证内容信号，不急着招商', '前 7-10 条用于测试表达方向；第 11 条起围绕有效题材连续做系列。');
  const cols = [
    ['目标', ['识别最有吸引力的老板痛点', '确定可长期出镜的人设', '获得第一批有效咨询'], C.green],
    ['内容动作', ['痛点型、案例型、避坑型各 2-4 条', '30-60 秒，首 3 秒给冲突或结果', '每条只讲一个问题和一个动作'], C.coral],
    ['必须准备', ['主页定位与企业联系方式', '私信关键词自动回复', '门店诊断表 / 线索登记表'], 'D49432']
  ];
  cols.forEach((c, i) => {
    const x = 0.72 + i * 4.15;
    box(s, x, 2.1, 3.73, 3.6, C.white);
    s.addShape(pptx.ShapeType.rect, { x, y: 2.1, w: 0.1, h: 3.6, fill: { color: c[2] }, line: { color: c[2] } });
    addText(s, c[0], x + 0.34, 2.48, 2.8, 0.32, { fontSize: 15, bold: true });
    bulletList(s, c[1], x + 0.35, 3.15, 2.95, 1.9, { fontSize: 9.5, paraSpaceAfterPt: 10 });
  });
  addText(s, '首轮淘汰标准：只有泛娱乐播放、没有目标老板互动的选题，不作为后续主线。', 0.75, 6.12, 11.3, 0.26, { fontSize: 10, bold: true, color: '9D3F2B' });
}

// 6 Content pillars
{
  const s = pptx.addSlide('MASTER');
  title(s, '05 / 内容矩阵', '四类内容共同建立“懂经营、能落地”的认知', '核心不是教抖音技巧，而是展示如何让服务门店的流量、转化、复购和利润同时改善。');
  const data = [
    ['40%', '门店增长实操', '团购设计、到店成交、私域复购、员工话术、人效与利润'],
    ['30%', '真实案例复盘', '成功案例、失败复盘、问题诊断、调整过程和结果口径'],
    ['20%', '行业认知与避坑', '筛选代运营、预算误区、套餐定价、平台规则和经营误区'],
    ['10%', '自营店经营记录', '开店过程、日报、活动复盘、员工现场与数据验证']
  ];
  data.forEach((d, i) => {
    const y = 2.02 + i * 1.06;
    box(s, 0.74, y, 11.85, 0.78, i === 3 ? 'E4F2EC' : C.white);
    addText(s, d[0], 1.02, y + 0.2, 0.9, 0.25, { fontSize: 16, color: i === 1 ? C.coral : C.green, bold: true });
    addText(s, d[1], 2.22, y + 0.2, 2.3, 0.24, { fontSize: 12, bold: true });
    addText(s, d[2], 4.6, y + 0.18, 7.45, 0.29, { fontSize: 9.4, color: C.muted });
  });
  addText(s, '“揭秘同行”只占避坑内容的一部分。多用“如何判断”“如何算账”“先问这 5 个问题”，少用攻击型表达。', 0.78, 6.45, 11.2, 0.23, { fontSize: 9.2, color: C.muted });
}

// 7 Content formula
{
  const s = pptx.addSlide('MASTER');
  title(s, '06 / 单条视频结构', '60 秒内，只解决一个经营问题', '把真实问题说透，比“流量密码”“赋能打法”更容易获得服务业老板信任。');
  const steps = [
    ['01', '前三秒：结果或冲突', '“团购卖得越多越亏，通常卡在这笔账。”'],
    ['02', '描述现场问题', '“这家店有核销，但前台没有二次成交，技师没有引导复购。”'],
    ['03', '给出关键判断', '“先算平台扣点、人工和耗材，再决定套餐价格和引流边界。”'],
    ['04', '给一个可执行动作', '“把 59 元团购改成体验入口，设置加购和会员承接。”'],
    ['05', '轻量行动引导', '“评论/私信‘诊断’，领取门店增长检查表。”']
  ];
  steps.forEach((st, i) => {
    const y = 1.95 + i * 0.86;
    s.addShape(pptx.ShapeType.ellipse, { x: 0.78, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: i === 4 ? C.coral : C.green }, line: { color: i === 4 ? C.coral : C.green } });
    addText(s, st[0], 0.78, y + 0.15, 0.42, 0.13, { fontSize: 6.5, bold: true, color: C.white, align: 'center' });
    addText(s, st[1], 1.48, y + 0.07, 2.2, 0.25, { fontSize: 11.2, bold: true });
    addText(s, st[2], 4.1, y + 0.07, 7.4, 0.28, { fontSize: 9.6, color: C.muted });
    if (i < 4) s.addShape(pptx.ShapeType.line, { x: 0.99, y: y + 0.47, w: 0, h: 0.42, line: { color: C.line, width: 0.8 } });
  });
  box(s, 0.77, 6.36, 11.7, 0.43, 'F9E4DD', 'F0C5B6');
  addText(s, '禁忌：一条视频同时卖代运营、加盟、招聘和课程。一次只推进一个用户动作。', 1.05, 6.47, 11.0, 0.19, { fontSize: 9, color: '9D3F2B', bold: true });
}

// 8 Topics
{
  const s = pptx.addSlide('MASTER');
  title(s, '07 / 起号选题库', '先用老板的真实问题做标题，再用现场细节做证据', '以下选题可在前 2 周直接执行，并根据评论/私信拆成系列。');
  const topics = [
    ['痛点型', '按摩店一天没几个客人，通常不是位置差，而是这 3 个环节没做。'],
    ['利润型', '团购卖了很多，为什么店里还是没赚钱？先把这笔账算清。'],
    ['案例型', '一家服务门店从每天 8 单到 25 单，我们只改了这 4 件事。'],
    ['避坑型', '找代运营前，至少要让对方回答这 5 个问题。'],
    ['过程型', '自营按摩店第 7 天复盘：花了多少、来了多少、问题出在哪。'],
    ['人效型', '团购客到店后，员工只要少说这一句，复购就会掉一半。']
  ];
  topics.forEach((t, i) => {
    const x = i % 2 === 0 ? 0.75 : 6.72;
    const y = 1.95 + Math.floor(i / 2) * 1.38;
    box(s, x, y, 5.83, 1.02, C.white);
    pill(s, t[0], x + 0.25, y + 0.25, 0.82, i % 2 ? C.coral : C.green);
    addText(s, t[1], x + 1.3, y + 0.18, 4.15, 0.56, { fontSize: 9.35, bold: true, valign: 'top' });
  });
  addText(s, '选题来源优先级：线下咨询原话 > 门店经营现场 > 平台热点 > 主观猜测。', 0.78, 6.38, 11.4, 0.24, { fontSize: 9.7, color: C.green, bold: true });
}

// 9. Content Calendar
{
  const s = pptx.addSlide('MASTER');
  title(s, '08 / 周内容排期', '每周 4-6 条短视频 + 1 场诊断型直播', '把内容生产变成稳定节奏，避免“只在有灵感时更新”。');
  const days = [
    ['周一', '门店诊断', '拆一个常见经营问题'],
    ['周二', '案例复盘', '结果 + 过程 + 方法'],
    ['周三', '避坑认知', '预算、团购、代运营选择'],
    ['周四', '自营店现场', '经营日报或活动复盘'],
    ['周五', '实操方法', '一个动作讲透'],
    ['周末', '直播 / 切片', '拆 3 家门店问题，再剪短视频']
  ];
  days.forEach((d, i) => {
    const x = 0.74 + (i % 3) * 4.14;
    const y = 2.05 + Math.floor(i / 3) * 1.65;
    box(s, x, y, 3.74, 1.28, i === 5 ? 'F9E4DD' : C.white);
    addText(s, d[0], x + 0.25, y + 0.25, 0.6, 0.2, { fontSize: 9, bold: true, color: i === 5 ? '9D3F2B' : C.green });
    addText(s, d[1], x + 1.05, y + 0.23, 2.2, 0.25, { fontSize: 12, bold: true });
    addText(s, d[2], x + 1.05, y + 0.7, 2.2, 0.2, { fontSize: 8.7, color: C.muted });
  });
  box(s, 0.75, 5.6, 11.8, 0.64, 'E4F2EC', C.mint);
  addText(s, '每周固定 30 分钟复盘：看高质量评论、有效私信和线索来源，而不是只看播放量。', 1.02, 5.8, 11.15, 0.22, { fontSize: 9.8, bold: true, color: C.green });
}

// 10. Measurement
{
  const s = pptx.addSlide('MASTER');
  title(s, '09 / 数据看板', '从“内容信号”一路看至“商业结果”', '同一条视频要同时看流量质量与线索质量；高播放但没有目标老板互动，不是有效内容。');
  const metrics = [
    ['内容层', '首 3 秒留存 / 完播率', '判断标题、开头和叙事是否成立'],
    ['互动层', '高质量评论 / 收藏 / 转发', '判断是否击中目标老板的真实问题'],
    ['线索层', '私信数 / 加微数 / 诊断预约', '判断行动引导与承接效率'],
    ['生意层', '方案成交 / 陪跑成交 / 合作意向', '判断内容是否带来可持续业务']
  ];
  metrics.forEach((m, i) => {
    const y = 2.04 + i * 1.0;
    addText(s, m[0], 0.82, y + 0.15, 1.1, 0.2, { fontSize: 9.2, color: i < 2 ? C.green : C.coral, bold: true });
    box(s, 2.0, y, 3.15, 0.58, C.white);
    addText(s, m[1], 2.25, y + 0.16, 2.65, 0.2, { fontSize: 9.4, bold: true });
    s.addShape(pptx.ShapeType.chevron, { x: 5.5, y: y + 0.16, w: 0.35, h: 0.24, fill: { color: C.line }, line: { color: C.line } });
    addText(s, m[2], 6.2, y + 0.16, 5.7, 0.22, { fontSize: 9.4, color: C.muted });
  });
  const chartData = [
    { label: '泛播放', w: 5.2, c: 'B5C4BF' },
    { label: '目标互动', w: 3.1, c: C.green },
    { label: '有效私信', w: 1.7, c: C.coral },
    { label: '成交/合作', w: 0.75, c: 'D49432' }
  ];
  chartData.forEach((d, i) => {
    const y = 6.08 + i * 0.17;
    s.addShape(pptx.ShapeType.rect, { x: 0.82, y, w: d.w, h: 0.11, fill: { color: d.c }, line: { color: d.c } });
    addText(s, d.label, 6.35, y - 0.04, 1.1, 0.16, { fontSize: 6.5, color: C.muted });
  });
  addText(s, '漏斗不追求同一比例，重点是每周持续记录、比较和优化。', 7.5, 6.12, 4.2, 0.18, { fontSize: 7.2, color: C.muted });
}

// 11 lead funnel
{
  const s = pptx.addSlide('MASTER');
  title(s, '10 / 线索转化', '短视频不直接成交高客单，先用低门槛产品筛选需求', '用“免费初诊 / 检查表”换取有效沟通，再按业务类型进入不同成交流程。');
  const funnel = [
    ['视频触达', '问题型内容', 3.1, C.green],
    ['评论 / 私信', '关键词触发', 2.55, '188C7B'],
    ['初步筛选', '门店/城市/预算/目标', 2.05, C.coral],
    ['诊断与方案', '付费诊断或一对一沟通', 1.5, 'C9573D'],
    ['成交分流', '代运营 / 加盟 / 合作', 0.98, 'A54534']
  ];
  funnel.forEach((f, i) => {
    const x = 0.9 + i * 2.38 + (i * 0.07);
    const y = 2.45 + i * 0.23;
    s.addShape(pptx.ShapeType.trapezoid, { x, y, w: f[2], h: 1.52, adjustPoint: 0.18, fill: { color: f[3] }, line: { color: f[3] } });
    addText(s, f[0], x + 0.12, y + 0.4, f[2] - 0.25, 0.22, { fontSize: 9.4, color: C.white, bold: true, align: 'center' });
    addText(s, f[1], x + 0.15, y + 0.82, f[2] - 0.3, 0.3, { fontSize: 6.8, color: 'E8F4F0', align: 'center', valign: 'top' });
  });
  box(s, 0.85, 5.26, 11.6, 0.76, C.white);
  addText(s, '私信第一问：', 1.12, 5.52, 1.05, 0.2, { fontSize: 9.3, color: C.green, bold: true });
  addText(s, '您目前是已有门店，准备开店，还是想做本地合作？', 2.12, 5.52, 3.85, 0.2, { fontSize: 9.3, bold: true });
  addText(s, '目的：快速分流，避免把所有人塞进同一套资料和销售话术。', 6.25, 5.52, 5.1, 0.2, { fontSize: 9, color: C.muted });
}

// 12 proof
{
  const s = pptx.addSlide('MASTER');
  title(s, '11 / 自营店证明体系', '从“晒业绩”升级为“公开经营模型验证”', '客户相信的不是一张营收截图，而是可解释、可复盘、可复制的经营过程。');
  const proof = [
    ['数据口径', '城市、门店类型、周期、投入、数据来源要说清'],
    ['经营过程', '选品、团购、引流、到店成交、会员复购的调整过程'],
    ['失败复盘', '活动亏损、员工执行偏差、转化不足，以及如何止损'],
    ['复制证据', '标准选址、产品、培训、开业和运营动作的沉淀']
  ];
  proof.forEach((p, i) => {
    const x = i % 2 === 0 ? 0.75 : 6.78;
    const y = 2.05 + Math.floor(i / 2) * 1.47;
    box(s, x, y, 5.8, 1.12, i === 3 ? 'E4F2EC' : C.white);
    addText(s, `0${i + 1}`, x + 0.28, y + 0.28, 0.48, 0.2, { fontSize: 10.5, color: C.coral, bold: true });
    addText(s, p[0], x + 1.02, y + 0.25, 1.2, 0.23, { fontSize: 11.5, bold: true });
    addText(s, p[1], x + 2.25, y + 0.24, 3.15, 0.4, { fontSize: 8.9, color: C.muted, valign: 'top' });
  });
  box(s, 0.78, 5.68, 11.65, 0.55, 'F9E4DD', 'F0C5B6');
  addText(s, '边界：不承诺回本周期、保底收益或“躺赚”；明确不同城市、门店和执行力会影响结果。', 1.05, 5.87, 11.0, 0.2, { fontSize: 9.3, color: '9D3F2B', bold: true });
}

// 13 franchise
{
  const s = pptx.addSlide('MASTER');
  title(s, '12 / 加盟与合伙人', '先验证可复制性，再分批测试合作需求', '不要从知识内容突然跳到“全国招商”；先让用户看到模型，再判断是否匹配。');
  const groups = [
    ['加盟候选人', '有资金 / 场地 / 开店意愿', '品牌、投入预算、单店模型、支持清单、风险边界'],
    ['城市合伙人', '有本地资源 / 团队 / 运营能力', '区域资源、分工、试点机制、长期投入与考核']
  ];
  groups.forEach((g, i) => {
    const x = i === 0 ? 0.78 : 6.82;
    box(s, x, 2.12, 5.7, 2.55, C.white);
    pill(s, g[0], x + 0.3, 2.43, 1.28, i === 0 ? C.coral : 'D49432');
    addText(s, '典型特征', x + 0.3, 3.04, 0.9, 0.18, { fontSize: 7.7, color: C.muted, bold: true });
    addText(s, g[1], x + 0.3, 3.34, 4.7, 0.25, { fontSize: 10.7, bold: true });
    addText(s, '应提供的资料', x + 0.3, 3.9, 1.2, 0.18, { fontSize: 7.7, color: C.muted, bold: true });
    addText(s, g[2], x + 0.3, 4.18, 4.85, 0.28, { fontSize: 9.1, color: C.ink });
  });
  addText(s, '推荐引导语：我们正在验证一套服务业门店增长模型，想开店或有本地资源的老板，可私信“合作”先看是否匹配。', 0.8, 5.36, 11.6, 0.34, { fontSize: 10.1, color: C.green, bold: true, valign: 'top' });
  addText(s, '达到稳定咨询后：主账号继续做信任与泛服务业流量，另开垂直招商账号承接考察、政策和案例。', 0.8, 6.02, 11.6, 0.21, { fontSize: 9.1, color: C.muted });
}

// 14 roles
{
  const s = pptx.addSlide('MASTER');
  title(s, '13 / 团队分工', '四个角色，围绕“内容 - 线索 - 交付 - 复盘”闭环协同', '小团队可以一人兼多岗，但责任人和交接节点必须明确。');
  const roles = [
    ['老板 / 主理人', '出镜与经营判断', '讲真实案例；审内容；参与高意向诊断和合作决策', C.green],
    ['内容运营', '选题与发布', '采集问题；写脚本；拍剪发布；整理评论与数据', C.coral],
    ['线索顾问', '私信与筛选', '关键词回复；信息收集；预约诊断；客户标签和跟进', 'D49432'],
    ['门店运营', '案例与交付', '提供现场素材、经营数据；验证动作；沉淀 SOP', '3A8275']
  ];
  roles.forEach((r, i) => {
    const y = 1.93 + i * 1.08;
    box(s, 0.75, y, 11.8, 0.8, C.white);
    s.addShape(pptx.ShapeType.rect, { x: 0.75, y, w: 0.12, h: 0.8, fill: { color: r[3] }, line: { color: r[3] } });
    addText(s, r[0], 1.1, y + 0.24, 1.65, 0.21, { fontSize: 11, bold: true });
    addText(s, r[1], 3.0, y + 0.25, 1.55, 0.18, { fontSize: 8.7, bold: true, color: r[3] });
    addText(s, r[2], 4.85, y + 0.2, 6.9, 0.28, { fontSize: 9, color: C.muted });
  });
  addText(s, '最低配置：主理人 + 内容运营 + 线索承接必须有人负责；门店运营提供真实素材和数据。', 0.78, 6.42, 11.25, 0.22, { fontSize: 9.5, color: C.green, bold: true });
}

// 15 operating mechanism
{
  const s = pptx.addSlide('MASTER');
  title(s, '14 / 周运营机制', '固定节奏，把经验变成可重复的经营系统', '周会只讨论三件事：什么内容有效、什么线索有效、哪个环节需要修正。');
  const rows = [
    ['周一', '选题会', '确定 5-6 条脚本；优先处理上周高频咨询问题'],
    ['周二-周四', '拍摄与发布', '连续发 3-4 条；评论区互动；收集用户原话'],
    ['每日', '线索跟进', '24 小时内回复私信；标签、预约、记录跟进状态'],
    ['周五', '数据复盘', '内容数据 + 私信质量 + 预约 + 成交情况'],
    ['周末', '直播与素材库', '直播拆店；把直播和现场素材切成下周内容']
  ];
  rows.forEach((r, i) => {
    const y = 1.92 + i * 0.8;
    addText(s, r[0], 0.9, y + 0.17, 0.95, 0.2, { fontSize: 9.5, bold: true, color: i === 2 ? C.coral : C.green });
    box(s, 2.0, y, 2.0, 0.52, 'FFFFFF');
    addText(s, r[1], 2.27, y + 0.15, 1.5, 0.2, { fontSize: 9.8, bold: true });
    addText(s, r[2], 4.35, y + 0.14, 7.3, 0.23, { fontSize: 9, color: C.muted });
    if (i < rows.length - 1) s.addShape(pptx.ShapeType.line, { x: 0.82, y: y + 0.63, w: 11.6, h: 0, line: { color: C.line, width: 0.5 } });
  });
  box(s, 0.82, 6.1, 11.6, 0.48, 'E4F2EC', C.mint);
  addText(s, '沉淀机制：每个有效案例，都要同步沉淀为“视频素材 + 销售案例 + 门店 SOP”。', 1.1, 6.26, 10.95, 0.18, { fontSize: 9.1, bold: true, color: C.green });
}

// 16 7-day checklist
{
  const s = pptx.addSlide('MASTER');
  title(s, '15 / 立即启动', '未来 7 天的最小可行行动清单', '先跑起来，再用真实的用户反馈迭代。以下动作完成后即可进入第一轮内容测试。');
  const items = [
    ['Day 1', '定账号名称、主页定位、出镜人和三条业务边界'],
    ['Day 2', '建立“老板原话”选题表、线索登记表和私信分流话术'],
    ['Day 3', '确定 10 个选题，完成前 5 条脚本'],
    ['Day 4', '集中拍摄；真实门店、白板、经营现场优先'],
    ['Day 5', '发布第 1 条；设置评论区与私信关键词引导'],
    ['Day 6', '发布第 2 条；记录评论和私信中的真实问题'],
    ['Day 7', '完成首次复盘：保留信号强的方向，修改下一周脚本']
  ];
  items.forEach((it, i) => {
    const x = i < 4 ? 0.78 + i * 3.05 : 2.32 + (i - 4) * 3.05;
    const y = i < 4 ? 2.04 : 4.27;
    box(s, x, y, 2.7, 1.45, C.white);
    pill(s, it[0], x + 0.25, y + 0.24, 0.58, i === 6 ? C.coral : C.green);
    addText(s, it[1], x + 0.25, y + 0.72, 2.12, 0.43, { fontSize: 8.5, color: C.ink, bold: true, valign: 'top' });
  });
  addText(s, '启动原则：内容必须有真实经营细节；承接必须有明确分流；复盘必须回到线索和成交。', 0.82, 6.35, 11.5, 0.22, { fontSize: 10, bold: true, color: C.green });
}

// 17 close
{
  const s = pptx.addSlide('MASTER');
  s.background = { color: C.charcoal };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: S.W, h: S.H, fill: { color: C.charcoal }, line: { color: C.charcoal } });
  s.addShape(pptx.ShapeType.rect, { x: 0.75, y: 0.82, w: 0.15, h: 4.75, fill: { color: C.coral }, line: { color: C.coral } });
  pill(s, '核心原则', 1.18, 1.02, 1.0, C.green);
  addText(s, '内容负责建立信任，\n自营店负责证明能力，\n转化系统负责筛选合作。', 1.18, 1.72, 8.8, 1.7, { fontSize: 27, bold: true, color: C.white, breakLine: true, valign: 'top' });
  addText(s, '持续验证，比等待爆款更重要。', 1.2, 4.03, 5.6, 0.28, { fontSize: 13, color: 'A7C8C0' });
  s.addShape(pptx.ShapeType.line, { x: 1.2, y: 5.32, w: 10.4, h: 0, line: { color: '59716B', width: 0.8 } });
  addText(s, '下一步：完成账号准备，发布首轮 7-10 条测试内容，建立每周复盘机制。', 1.2, 5.63, 9.7, 0.25, { fontSize: 10, color: 'DDE9E5' });
}

pptx.writeFile({ fileName: path.resolve(__dirname, '..', '..', '抖音账号增长与转化执行方案.pptx') });
