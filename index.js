require('dotenv').config();
const fs=require('fs'), path=require('path'), axios=require('axios');
const {Client,GatewayIntentBits,REST,Routes,SlashCommandBuilder,EmbedBuilder,PermissionFlagsBits,ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle}=require('discord.js');

const DATA_FILE=path.join(__dirname,'data.json');
const DEFAULT_REGION=process.env.DEFAULT_REGION||'eu';
const HENRIK_API_KEY=process.env.HENRIK_API_KEY||'';
const COLOR=0xff4655;

const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || '';
const TOURNAMENT_CHANNEL_ID = process.env.TOURNAMENT_CHANNEL_ID || '';

const TOURNAMENT_COMMANDS = ['فتح','توزيع','ابدأ','نتيجة','ريست'];

const maps=[['Bind','بايند'],['Haven','هيفن'],['Split','سبليت'],['Ascent','أسنت'],['Icebox','آيس بوكس'],['Breeze','بريز'],['Lotus','لوتس'],['Sunset','سنست'],['Abyss','أبيس'],['Corrode','كورود']].map(([en,ar])=>({en,ar}));
const ranks=['Iron 1','Iron 2','Iron 3','Bronze 1','Bronze 2','Bronze 3','Silver 1','Silver 2','Silver 3','Gold 1','Gold 2','Gold 3','Platinum 1','Platinum 2','Platinum 3','Diamond 1','Diamond 2','Diamond 3','Ascendant 1','Ascendant 2','Ascendant 3','Immortal 1','Immortal 2','Immortal 3','Radiant'];
const rankOrder=Object.fromEntries([['Unrated',0],...ranks.map((r,i)=>[r,i+1])]);

function def(){return {users:{},tournament:{open:false,teamCount:4,teamSize:5,players:[],teams:[],matches:[],currentMatch:0}}}
function load(){if(!fs.existsSync(DATA_FILE))fs.writeFileSync(DATA_FILE,JSON.stringify(def(),null,2));let d=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));d.users??={};d.tournament??=def().tournament;d.tournament.players??=[];d.tournament.teams??=[];d.tournament.matches??=[];d.tournament.currentMatch??=0;return d}
function save(d){fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2))}
function power(rank,rr){return (rankOrder[rank]||0)*100+Number(rr||0)}
function userScore(u){return power(u?.lastRank||'Unrated',u?.lastRR||0)}
function simpleEmbed(title,desc){return new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(desc||'لا توجد بيانات')}
function placeholder(name){return `الأمر **/${name}** مضاف.\nبعض التفاصيل تعتمد على توفر بيانات HenrikDev API ومباريات الحساب.`}
function topUsers(d,n=10){return Object.entries(d.users).sort((a,b)=>userScore(b[1])-userScore(a[1])).slice(0,n)}
function formatTop(list){return list.map(([id,u],idx)=>`**#${idx+1}** <@${id}> — ${u.name}#${u.tag} — **${u.lastRank||'Unrated'}** (${u.lastRR||0} RR)`).join('\n')||'لا يوجد لاعبين مربوطين.'}
function getLinkedUser(d,i,opt='user'){const target=i.options?.getUser?.(opt)||i.user;return {target,u:d.users[target.id]}}
async function getMMR(region,name,tag){
  const n=encodeURIComponent(name.trim()), t=encodeURIComponent(tag.trim().replace('#',''));
  const urls=[`https://api.henrikdev.xyz/valorant/v3/mmr/${region}/${n}/${t}`,`https://api.henrikdev.xyz/valorant/v2/mmr/${region}/${n}/${t}`,`https://api.henrikdev.xyz/valorant/v1/mmr/${region}/${n}/${t}`];
  let last;
  for(const url of urls){try{const r=await axios.get(url,{timeout:15000,headers:HENRIK_API_KEY?{Authorization:HENRIK_API_KEY}:{}});const x=r.data?.data;if(x)return{rank:x.currenttierpatched||x.current_data?.currenttierpatched||x.current_data?.currenttier_patched||'Unrated',rr:x.ranking_in_tier??x.current_data?.ranking_in_tier??0,elo:x.elo??x.current_data?.elo??0,peak:x.highest_rank?.patched_tier||x.highest_rank?.tier||'Unknown'}}catch(e){last=e}}
  throw last||new Error('MMR failed');
}
async function getMatches(region,name,tag){
  const n=encodeURIComponent(name.trim()), t=encodeURIComponent(tag.trim().replace('#',''));
  const urls=[`https://api.henrikdev.xyz/valorant/v3/matches/${region}/${n}/${t}`,`https://api.henrikdev.xyz/valorant/v1/lifetime/matches/${region}/${n}/${t}?size=10`];
  for(const url of urls){try{const r=await axios.get(url,{timeout:15000,headers:HENRIK_API_KEY?{Authorization:HENRIK_API_KEY}:{}});const data=r.data?.data;if(Array.isArray(data))return data;if(Array.isArray(data?.matches))return data.matches}catch(e){}}
  return [];
}
async function refreshUser(d,id){const u=d.users[id];if(!u)return null;const mmr=await getMMR(u.region,u.name,u.tag);u.lastRank=mmr.rank;u.lastRR=mmr.rr;u.lastELO=mmr.elo;u.lastRefresh=new Date().toISOString();save(d);return mmr}
function linkReply(i){
  const e=new EmbedBuilder().setColor(COLOR).setTitle('اربط حساب فالورانت أولاً').setDescription('اضغط الزر واربط حسابك ثم اضغط دخول البطولة.');
  const r=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('valorant_link_button').setLabel('🔗 ربط حساب Valorant').setStyle(ButtonStyle.Danger));
  return i.reply({embeds:[e],components:[r],ephemeral:true});
}
function openEmbed(t){return new EmbedBuilder().setColor(COLOR).setTitle('🏆 التسجيل مفتوح للبطولة').setDescription(`النظام: **Best Of 3**\nعدد التيمات: **${t.teamCount}**\nكل تيم: **${t.teamSize} لاعبين**\nالمسجلين: **${t.players.length}/${t.teamCount*t.teamSize}**`)}
function joinRow(dis=false){return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tour_join').setLabel('🎮 دخول البطولة').setStyle(ButtonStyle.Success).setDisabled(dis),new ButtonBuilder().setCustomId('tour_leave').setLabel('❌ خروج').setStyle(ButtonStyle.Secondary).setDisabled(dis))}
function makeTeams(d){
  const t=d.tournament;
  const ps=t.players.map(id=>{const u=d.users[id]||{};return{id,rank:u.lastRank||'Unrated',rr:u.lastRR||0,score:power(u.lastRank||'Unrated',u.lastRR||0)}}).sort((a,b)=>b.score-a.score);
  const teams=Array.from({length:t.teamCount},(_,i)=>({name:`الفريق ${i+1}`,captain:null,players:[],score:0}));
  for(const p of ps){teams.sort((a,b)=>a.score-b.score);teams[0].players.push(p);teams[0].score+=p.score}
  for(const tm of teams){tm.players.sort((a,b)=>b.score-a.score);tm.captain=tm.players[0]?.id||null}
  t.teams=teams;
}
function teamsEmbed(d){return new EmbedBuilder().setColor(COLOR).setTitle('⚖️ تم توزيع التيمات').setDescription(d.tournament.teams.map(tm=>`**${tm.name}**\n👑 الكابتن: ${tm.captain?`<@${tm.captain}>`:'غير محدد'}\n${tm.players.map(p=>`• <@${p.id}> — ${p.rank}`).join('\n')||'لا يوجد'}`).join('\n\n')||'لا توجد تيمات')}
function buildMatches(d){let ts=d.tournament.teams;d.tournament.matches=[];for(let i=0;i<ts.length;i+=2)if(ts[i]&&ts[i+1])d.tournament.matches.push({teamA:i,teamB:i+1,scoreA:0,scoreB:0,currentMap:0,maps:[],veto:null,done:false,winner:null,round:ts.length===2?'النهائي الكبير':'نصف النهائي'});d.tournament.currentMatch=0}
function createVeto(m){m.veto={turn:0,bans:[],picks:[],remaining:[...maps],done:false}}
function action(m){return ['ban','ban','pick','pick','ban','ban'][m.veto.turn]||'done'}
function turnTeam(d,m){return m.veto.turn%2===0?d.tournament.teams[m.teamA]:d.tournament.teams[m.teamB]}
function vetoEmbed(d,m){let tm=turnTeam(d,m),a=action(m);let title=a==='ban'?`دور ${tm.name} لحظر ماب`:a==='pick'?`دور ${tm.name} لاختيار ماب`:'انتهى الفيتو';return new EmbedBuilder().setColor(COLOR).setTitle(`🗺️ ${title}`).setDescription(`**${d.tournament.teams[m.teamA].name}** ضد **${d.tournament.teams[m.teamB].name}**\n\nالحظر:\n${m.veto.bans.map(x=>`❌ ${x.team}: ${x.map.ar}`).join('\n')||'لا يوجد'}\n\nالاختيارات:\n${m.veto.picks.map(x=>`✅ ${x.team}: ${x.map.ar}`).join('\n')||'لا يوجد'}`)}
function mapRows(m){let rows=[];for(let i=0;i<m.veto.remaining.length;i+=5)rows.push(new ActionRowBuilder().addComponents(m.veto.remaining.slice(i,i+5).map(mp=>new ButtonBuilder().setCustomId(`map_${mp.en}`).setLabel(mp.ar).setStyle(ButtonStyle.Primary))));return rows}
function finishVeto(m){let dec=m.veto.remaining[0];m.maps=[m.veto.picks[0].map,m.veto.picks[1].map,dec].map(mp=>({...mp,sides:Math.random()>0.5?'A_ATTACK':'B_ATTACK'}));m.veto.done=true}
function seriesEmbed(d,m){let A=d.tournament.teams[m.teamA],B=d.tournament.teams[m.teamB];return new EmbedBuilder().setColor(COLOR).setTitle('🏁 نتيجة الفيتو والسلسلة').setDescription(m.maps.map((mp,i)=>{let as=mp.sides==='A_ATTACK'?'الهجوم ⚔️':'الدفاع 🛡️',bs=mp.sides==='A_ATTACK'?'الدفاع 🛡️':'الهجوم ⚔️';return `**ماب ${i+1}: ${mp.ar}**\n${A.name}: ${as}\n${B.name}: ${bs}`}).join('\n\n'))}
function resultRow(d,m){let A=d.tournament.teams[m.teamA],B=d.tournament.teams[m.teamB];return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('result_A').setLabel(`${A.name} فاز`).setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('result_B').setLabel(`${B.name} فاز`).setStyle(ButtonStyle.Danger))}

const commands=[
new SlashCommandBuilder().setName('فتح').setDescription('فتح بطولة BO3').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addIntegerOption(o=>o.setName('عدد_التيمات').setDescription('2 أو 4 أو 8 أو 16').setRequired(false)).addIntegerOption(o=>o.setName('حجم_التيم').setDescription('الافتراضي 5').setRequired(false)),
new SlashCommandBuilder().setName('توزيع').setDescription('توزيع اللاعبين').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName('ابدأ').setDescription('بدء البطولة').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName('نتيجة').setDescription('تسجيل نتيجة الماب').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName('ريست').setDescription('تصفير البطولة').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName('setup').setDescription('رسالة ربط الحساب').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
new SlashCommandBuilder().setName('link').setDescription('ربط حساب فالورانت').addStringOption(o=>o.setName('name').setDescription('Riot name').setRequired(true)).addStringOption(o=>o.setName('tag').setDescription('tag').setRequired(true)).addStringOption(o=>o.setName('region').setDescription('eu/na/ap/kr').setRequired(false)),
new SlashCommandBuilder().setName('unlink').setDescription('فك ربط حساب فالورانت'),
new SlashCommandBuilder().setName('rank').setDescription('عرض الرانك').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('refresh').setDescription('تحديث الرانك يدويًا'),
new SlashCommandBuilder().setName('leaderboard').setDescription('توب السيرفر حسب الرانك'),
new SlashCommandBuilder().setName('radiant').setDescription('أفضل Radiant في السيرفر'),
new SlashCommandBuilder().setName('stats').setDescription('إحصائيات لاعب').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('lastmatch').setDescription('آخر مباراة').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('history').setDescription('تاريخ المباريات').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('winrate').setDescription('نسبة الفوز').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('tophs').setDescription('أفضل هيدشوت'),
new SlashCommandBuilder().setName('topkda').setDescription('أفضل KDA'),
new SlashCommandBuilder().setName('toprank').setDescription('أعلى رانك بالسيرفر'),
new SlashCommandBuilder().setName('toprr').setDescription('أعلى RR بالسيرفر'),
new SlashCommandBuilder().setName('mostmap').setDescription('أكثر ماب لعبته').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('mainagent').setDescription('أكثر Agent لعبته').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('bestagent').setDescription('أفضل Agent لك').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('ingame').setDescription('هل اللاعب داخل مباراة؟').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('matchplayers').setDescription('عرض تشكيلة المباراة').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('matchmmr').setDescription('MMR المباراة').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('mostwins').setDescription('أكثر لاعب فاز'),
new SlashCommandBuilder().setName('mostplayed').setDescription('أكثر لاعب لعب'),
new SlashCommandBuilder().setName('mvp').setDescription('أكثر MVP'),
new SlashCommandBuilder().setName('card').setDescription('بطاقة رانك احترافية').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('rankcard').setDescription('رانك كارد').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('profile').setDescription('بروفايل فالورانت').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('compare').setDescription('مقارنة لاعبين').addUserOption(o=>o.setName('player1').setDescription('اللاعب الأول').setRequired(true)).addUserOption(o=>o.setName('player2').setDescription('اللاعب الثاني').setRequired(true)),
new SlashCommandBuilder().setName('predict').setDescription('توقع الفائز').addUserOption(o=>o.setName('player1').setDescription('اللاعب الأول').setRequired(true)).addUserOption(o=>o.setName('player2').setDescription('اللاعب الثاني').setRequired(true)),
new SlashCommandBuilder().setName('mmr').setDescription('حساب MMR / ELO').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('rrneeded').setDescription('كم تحتاج RR للترقية').addUserOption(o=>o.setName('user').setDescription('عضو اختياري').setRequired(false)),
new SlashCommandBuilder().setName('analyze').setDescription('تحليل اللعب'),
new SlashCommandBuilder().setName('suggestagent').setDescription('اقتراح Agent'),
new SlashCommandBuilder().setName('sens').setDescription('أفضل Sens'),
new SlashCommandBuilder().setName('crosshair').setDescription('أفضل Crosshair'),
new SlashCommandBuilder().setName('help').setDescription('عرض جميع أوامر البوت'),
new SlashCommandBuilder().setName('panel').setDescription('رسالة البوت الرئيسية'),
].map(c=>c.toJSON());

async function register(){const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);await rest.put(Routes.applicationGuildCommands(
  process.env.CLIENT_ID,
  process.env.GUILD_ID
),{body:commands});console.log('Slash commands registered.')}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
client.once('ready',()=>console.log(`Bot is online as ${client.user.tag}`));

client.on('interactionCreate',async i=>{
try{
const d=load();


if(i.isButton()&&i.customId==='valorant_link_button'){let modal=new ModalBuilder().setCustomId('valorant_link_modal').setTitle('ربط حساب Valorant');modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('riot_name').setLabel('Riot Name').setPlaceholder('Waleed').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('riot_tag').setLabel('Tag بدون #').setPlaceholder('00007').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('riot_region').setLabel('Region').setValue(DEFAULT_REGION).setStyle(TextInputStyle.Short).setRequired(true)));return i.showModal(modal)}
if(i.isModalSubmit()&&i.customId==='valorant_link_modal'){await i.deferReply({ephemeral:true});let name=i.fields.getTextInputValue('riot_name').trim(),tag=i.fields.getTextInputValue('riot_tag').replace('#','').trim(),region=i.fields.getTextInputValue('riot_region').trim().toLowerCase();let mmr=await getMMR(region,name,tag);d.users[i.user.id]={name,tag,region,lastRank:mmr.rank,lastRR:mmr.rr,lastELO:mmr.elo,linkedAt:new Date().toISOString()};save(d);return i.editReply(`✅ تم الربط: **${name}#${tag}** — **${mmr.rank}** (${mmr.rr} RR)`)}

if(i.isButton()&&i.customId==='tour_join'){let t=d.tournament;if(!t.open)return i.reply({content:'التسجيل مغلق.',ephemeral:true});if(!d.users[i.user.id])return linkReply(i);if(t.players.includes(i.user.id))return i.reply({content:'أنت مسجل بالفعل.',ephemeral:true});if(t.players.length>=t.teamCount*t.teamSize)return i.reply({content:'البطولة ممتلئة.',ephemeral:true});let u=d.users[i.user.id];try{let mmr=await getMMR(u.region,u.name,u.tag);u.lastRank=mmr.rank;u.lastRR=mmr.rr;u.lastELO=mmr.elo}catch(e){}t.players.push(i.user.id);if(t.players.length>=t.teamCount*t.teamSize)t.open=false;save(d);try{const messages=await i.channel.messages.fetch({limit:10});const msg=messages.find(m=>m.author.id===client.user.id&&m.embeds.length>0&&m.embeds[0].title?.includes('التسجيل مفتوح'));if(msg)await msg.edit({embeds:[openEmbed(t)],components:[joinRow(!t.open)]})}catch(e){}return i.reply({content:'✅ تم تسجيلك في البطولة.',ephemeral:true})}
if(i.isButton()&&i.customId==='tour_leave'){d.tournament.players=d.tournament.players.filter(id=>id!==i.user.id);save(d);return i.reply({content:'تم خروجك من البطولة.',ephemeral:true})}
if(i.isButton()&&i.customId.startsWith('map_')){let m=d.tournament.matches[d.tournament.currentMatch];if(!m||!m.veto||m.done)return i.reply({content:'لا يوجد فيتو نشط.',ephemeral:true});let tm=turnTeam(d,m);if(i.user.id!==tm.captain)return i.reply({content:'❌ فقط كابتن الفريق يقدر يختار.',ephemeral:true});let mp=m.veto.remaining.find(x=>x.en===i.customId.replace('map_',''));if(!mp)return i.reply({content:'الماب غير متاح.',ephemeral:true});let a=action(m);m.veto.remaining=m.veto.remaining.filter(x=>x.en!==mp.en);if(a==='ban')m.veto.bans.push({team:tm.name,map:mp});if(a==='pick')m.veto.picks.push({team:tm.name,map:mp});m.veto.turn++;if(action(m)==='done'){finishVeto(m);save(d);return i.update({embeds:[seriesEmbed(d,m)],components:[resultRow(d,m)]})}save(d);return i.update({embeds:[vetoEmbed(d,m)],components:mapRows(m)})}
if(i.isButton()&&(i.customId==='result_A'||i.customId==='result_B')){if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return i.reply({content:'فقط الإدارة تسجل النتائج.',ephemeral:true});let t=d.tournament,m=t.matches[t.currentMatch];if(!m)return i.reply({content:'لا توجد مباراة نشطة.',ephemeral:true});let A=t.teams[m.teamA],B=t.teams[m.teamB];if(i.customId==='result_A')m.scoreA++;else m.scoreB++;m.currentMap++;if(m.scoreA===2||m.scoreB===2){m.done=true;m.winner=m.scoreA===2?m.teamA:m.teamB;let win=t.teams[m.winner];if(t.matches.every(x=>x.done)){if(t.matches.length===1){save(d);return i.update({embeds:[new EmbedBuilder().setColor(0xfacc15).setTitle('👑 بطل البطولة').setDescription(`🏆 **${win.name}**\nالنتيجة: **${m.scoreA} - ${m.scoreB}**`)],components:[]})}let winners=t.matches.map(x=>x.winner);t.teams=winners.map(idx=>t.teams[idx]);buildMatches(d);createVeto(t.matches[0]);save(d);return i.update({embeds:[new EmbedBuilder().setColor(COLOR).setTitle('🏆 النهائي الكبير').setDescription(`${t.teams[0].name} ضد ${t.teams[1].name}`),vetoEmbed(d,t.matches[0])],components:mapRows(t.matches[0])})}t.currentMatch++;let nx=t.matches[t.currentMatch];createVeto(nx);save(d);return i.update({embeds:[new EmbedBuilder().setColor(COLOR).setTitle('✅ انتهت السلسلة').setDescription(`${win.name} تأهل. النتيجة: **${m.scoreA}-${m.scoreB}**`),vetoEmbed(d,nx)],components:mapRows(nx)})}save(d);return i.update({embeds:[new EmbedBuilder().setColor(COLOR).setTitle('🏆 النتيجة الحالية').setDescription(`${A.name} **${m.scoreA} - ${m.scoreB}** ${B.name}\n${m.scoreA===1&&m.scoreB===1?'🔥 سيتم لعب الماب الثالث':'انتقلوا للماب التالي'}`)],components:[resultRow(d,m)]})}

if(!i.isChatInputCommand())return;

if(
  TOURNAMENT_COMMANDS.includes(i.commandName) &&
  TOURNAMENT_CHANNEL_ID &&
  i.channelId !== TOURNAMENT_CHANNEL_ID
){
  return i.reply({
    content:'❌ أوامر البطولة مسموحة فقط في روم البطولة.',
    ephemeral:true
  });
}

if(
  !TOURNAMENT_COMMANDS.includes(i.commandName) &&
  ALLOWED_CHANNEL_ID &&
  i.channelId !== ALLOWED_CHANNEL_ID
){
  return i.reply({
    content:'❌ أوامر البوت العامة مسموحة فقط في روم البوت.',
    ephemeral:true
  });
}

if(i.commandName==='setup'){let e=new EmbedBuilder().setColor(COLOR).setTitle('ربط حساب Valorant').setDescription('اضغط الزر واربط حسابك.');let r=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('valorant_link_button').setLabel('🔗 ربط حساب Valorant').setStyle(ButtonStyle.Danger));return i.reply({embeds:[e],components:[r]})}
if(i.commandName==='link'){await i.deferReply({ephemeral:true});let name=i.options.getString('name'),tag=i.options.getString('tag').replace('#',''),region=i.options.getString('region')||DEFAULT_REGION;let mmr=await getMMR(region,name,tag);d.users[i.user.id]={name,tag,region,lastRank:mmr.rank,lastRR:mmr.rr,lastELO:mmr.elo,linkedAt:new Date().toISOString()};save(d);return i.editReply(`✅ تم الربط: **${name}#${tag}** — **${mmr.rank}** (${mmr.rr} RR)`)}
if(i.commandName==='unlink'){delete d.users[i.user.id];save(d);return i.reply({content:'✅ تم فك ربط حسابك.',ephemeral:true})}
if(i.commandName==='rank'){const {target,u}=getLinkedUser(d,i);if(!u)return linkReply(i);await i.deferReply({ephemeral:true});let mmr=await getMMR(u.region,u.name,u.tag);u.lastRank=mmr.rank;u.lastRR=mmr.rr;u.lastELO=mmr.elo;save(d);return i.editReply(`**${u.name}#${u.tag}**\nRank: **${mmr.rank}** | RR: **${mmr.rr}**\nDiscord: <@${target.id}>`)}
if(i.commandName==='refresh'){let u=d.users[i.user.id];if(!u)return linkReply(i);await i.deferReply({ephemeral:true});let mmr=await refreshUser(d,i.user.id);return i.editReply(`✅ تم التحديث\n**${u.name}#${u.tag}** — **${mmr.rank}** (${mmr.rr} RR)`)}
if(i.commandName==='leaderboard')return i.reply({embeds:[simpleEmbed('🏆 Valorant Leaderboard',formatTop(topUsers(d,10)))]})
if(i.commandName==='radiant'){let list=Object.entries(d.users).filter(([id,u])=>(u.lastRank||'').includes('Radiant'));return i.reply({embeds:[simpleEmbed('👑 Radiant Players',formatTop(list))]})}
if(i.commandName==='profile'||i.commandName==='card'||i.commandName==='rankcard'||i.commandName==='stats'||i.commandName==='rrneeded'){const {target,u}=getLinkedUser(d,i);if(!u)return linkReply(i);let rr=Number(u.lastRR||0),need=Math.max(0,100-rr);let e=new EmbedBuilder().setColor(COLOR).setTitle(i.commandName==='profile'?'VALORANT PROFILE':'🎴 Valorant Card').setDescription(`**${u.name}#${u.tag}**`).addFields({name:'Rank',value:String(u.lastRank||'Unrated'),inline:true},{name:'RR',value:String(rr),inline:true},{name:'ELO',value:String(u.lastELO||'غير متوفر'),inline:true},{name:'Region',value:String(u.region||DEFAULT_REGION),inline:true},{name:'RR للترقية',value:`${need} RR`,inline:true},{name:'Discord',value:`<@${target.id}>`,inline:true}).setTimestamp();return i.reply({embeds:[e]})}
if(i.commandName==='mmr'){
  const {target,u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  let mmr=await getMMR(u.region,u.name,u.tag);

  const e=new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('📊 Match MMR')
    .setDescription(`**${u.name}#${u.tag}**`)
    .addFields(
      {name:'🏆 Rank',value:mmr.rank || 'Unknown',inline:true},
      {name:'🎯 RR',value:String(mmr.rr || 0),inline:true},
      {name:'⚡ ELO',value:String(mmr.elo || 0),inline:true},
      {name:'🌍 Region',value:u.region || DEFAULT_REGION,inline:true}
    )
    .setFooter({text:`Requested by ${target.username}`})
    .setTimestamp();

  return i.editReply({embeds:[e]});
}
if(i.commandName==='toprank')return i.reply({embeds:[simpleEmbed('🏆 أعلى رانك بالسيرفر',formatTop(topUsers(d,10)))]})
if(i.commandName==='toprr'){let list=Object.entries(d.users).sort((a,b)=>Number(b[1].lastRR||0)-Number(a[1].lastRR||0)).slice(0,10);return i.reply({embeds:[simpleEmbed('🎯 أعلى RR بالسيرفر',formatTop(list))]})}
if(i.commandName==='compare'||i.commandName==='predict'){let p1=i.options.getUser('player1'),p2=i.options.getUser('player2'),u1=d.users[p1.id],u2=d.users[p2.id];if(!u1||!u2)return i.reply({content:'لازم الاثنين يكونون رابطين حساباتهم.',ephemeral:true});let winner=userScore(u1)>=userScore(u2)?p1:p2;let desc=`<@${p1.id}> — **${u1.lastRank}** (${u1.lastRR||0} RR)\n<@${p2.id}> — **${u2.lastRank}** (${u2.lastRR||0} RR)\n\n${i.commandName==='predict'?`🔮 التوقع: <@${winner.id}> أقرب للفوز حسب الرانك.`:''}`;return i.reply({embeds:[simpleEmbed(i.commandName==='compare'?'⚔️ مقارنة لاعبين':'🔮 توقع الفائز',desc)]})}
if(i.commandName==='stats'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ لا توجد مباريات.');
  }

  const match=matches[0];

  const players=match.players?.all_players||[];

  const me=players.find(
    p=>p.name?.toLowerCase()===u.name.toLowerCase()
  );

  if(!me){
    return i.editReply('❌ لم يتم العثور على بيانات اللاعب.');
  }

  const kills=me.stats?.kills||0;
  const deaths=me.stats?.deaths||0;
  const assists=me.stats?.assists||0;
  const hs=me.stats?.headshots||0;

  return i.editReply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`📊 Stats — ${u.name}#${u.tag}`)
        .addFields(
          {name:'🔫 Kills',value:String(kills),inline:true},
          {name:'💀 Deaths',value:String(deaths),inline:true},
          {name:'🤝 Assists',value:String(assists),inline:true},
          {name:'🎯 Headshots',value:String(hs),inline:true}
        )
    ]
  });
}
if(i.commandName==='history'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches = await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ لا توجد مباريات.');
  }

  const history = matches.slice(0,5).map((m,index)=>{

    const meta = m.metadata || {};
    const players = m.players?.all_players || [];

    const me = players.find(
      p =>
        p.name?.toLowerCase() === u.name.toLowerCase()
    );

    const kills = me?.stats?.kills || 0;
    const deaths = me?.stats?.deaths || 0;
    const assists = me?.stats?.assists || 0;

    const result =
      me?.team?.toLowerCase() === m.teams?.red?.has_won?.toString()
      ? '🏆 Win'
      : '❌ Lose';

    return `**${index+1}. ${meta.map || 'Unknown Map'}**
🎯 ${kills}/${deaths}/${assists}
${result}`;
  }).join('\n\n');

  return i.editReply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`📜 Match History — ${u.name}#${u.tag}`)
        .setDescription(history)
    ]

    });
}
if(i.commandName==='winrate'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(
    u.region,
    u.name,
    u.tag
  );

  if(!matches.length){
    return i.editReply('❌ لا توجد مباريات.');
  }

  let wins = 0;
  let total = 0;

  for(const match of matches){

    const players=match.players?.all_players||[];

    const me=players.find(
      p=>p.name?.toLowerCase()===u.name.toLowerCase()
    );

    if(!me) continue;

    total++;

    const won =
      me.team?.toLowerCase() ===
      (
        match.teams?.red?.has_won
        ? 'red'
        : 'blue'
      );

    if(won) wins++;
  }

  const rate =
    ((wins/Math.max(total,1))*100).toFixed(1);

  return i.editReply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('📈 Win Rate')
        .setDescription(
          `🏆 الفوز: ${wins}\n🎮 المباريات: ${total}\n📊 النسبة: ${rate}%`
        )
    ]
  });
}

if(i.commandName==='lastmatch'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ لا توجد مباريات.');
  }

  const match=matches[0];

  const players=match.players?.all_players||[];

  const me=players.find(
    p=>p.name?.toLowerCase()===u.name.toLowerCase()
  );

  const map=match.metadata?.map||'Unknown';
  const agent=me?.character||'Unknown';

  return i.editReply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🎮 آخر مباراة')
        .setDescription(
          `🗺️ الماب: ${map}\n🧍 Agent: ${agent}`
        )
    ]
  });
}

if(i.commandName==='mostmap' || i.commandName==='mainagent' || i.commandName==='bestagent'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ ما لقيت مباريات.');
  }

  let mapsCount={};
  let agentsCount={};

  for(const match of matches){

    const players=match.players?.all_players||[];

    const me=players.find(
      p=>p.name?.toLowerCase()===u.name.toLowerCase()
    );

    if(!me) continue;

    const mapName=match.metadata?.map||'Unknown';
    const agentName=me.character||'Unknown';

    mapsCount[mapName]=(mapsCount[mapName]||0)+1;
    agentsCount[agentName]=(agentsCount[agentName]||0)+1;
  }

  const topMap=Object.entries(mapsCount)
    .sort((a,b)=>b[1]-a[1])[0];

  const topAgent=Object.entries(agentsCount)
    .sort((a,b)=>b[1]-a[1])[0];

  if(i.commandName==='mostmap'){
    return i.editReply({
      embeds:[
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('🗺️ أكثر ماب لعبته')
          .setDescription(
            `الماب: **${topMap?.[0]||'Unknown'}**\nعدد المرات: **${topMap?.[1]||0}**`
          )
      ]
    });
  }

  if(i.commandName==='mainagent'){
    return i.editReply({
      embeds:[
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('🧍 أكثر Agent لعبته')
          .setDescription(
            `العميل: **${topAgent?.[0]||'Unknown'}**\nعدد المرات: **${topAgent?.[1]||0}**`
          )
      ]
    });
  }

  if(i.commandName==='bestagent'){
    return i.editReply({
      embeds:[
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('⭐ أفضل Agent لك')
          .setDescription(
            `أفضل Agent: **${topAgent?.[0]||'Unknown'}**`
          )
      ]
    });
  }
}

if(i.commandName==='analyze'){let u=d.users[i.user.id];if(!u)return linkReply(i);await i.deferReply();let matches=await getMatches(u.region,u.name,u.tag);if(!matches.length)return i.editReply('❌ لا توجد مباريات للتحليل.');let match=matches[0];let allPlayers=match.players?.all_players||match.players||[];let player=allPlayers.find(p=>p.name?.toLowerCase()===u.name.toLowerCase());if(!player)return i.editReply('❌ لم يتم العثور على بيانات اللاعب.');let kills=player.stats?.kills||player.kills||0,deaths=player.stats?.deaths||player.deaths||0,assists=player.stats?.assists||player.assists||0,map=match.metadata?.map||match.map?.name||'Unknown',agent=player.character||player.agent||'Unknown',kda=((kills+assists)/Math.max(deaths,1)).toFixed(2);let tips=[];if(Number(kda)<1)tips.push('حاول تقلل الموت أكثر.');if(Number(kda)>=1&&Number(kda)<1.5)tips.push('مستواك جيد لكن يحتاج ثبات أكثر.');if(Number(kda)>=1.5)tips.push('🔥 أداء قوي جدًا.');if(deaths>kills)tips.push('ركز على التمركز وعدم الاندفاع.');return i.editReply({embeds:[new EmbedBuilder().setColor(COLOR).setTitle(`🎯 تحليل ${u.name}#${u.tag}`).setDescription('🔥 تحليل مباشر لآخر مباراة').addFields({name:'🗺️ الماب',value:String(map),inline:true},{name:'🧍 العميل',value:String(agent),inline:true},{name:'🔫 Kills',value:String(kills),inline:true},{name:'💀 Deaths',value:String(deaths),inline:true},{name:'🤝 Assists',value:String(assists),inline:true},{name:'📊 KDA',value:String(kda),inline:true},{name:'💡 نصائح',value:tips.join('\n')||'أداء ممتاز 🔥',inline:false})]})}
if(i.commandName==='matchplayers'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ لا توجد مباريات.');
  }

  const match=matches[0];

  const players=match.players?.all_players||[];

  const text=players.map(p=>{
    const rank=p.currenttier_patched||'Unknown';
    return `• ${p.name}#${p.tag} — ${rank}`;
  }).join('\n');

  return i.editReply({
    embeds:[
      new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('👥 Players In Match')
      .setDescription(text)
    ]
  });
}

if(i.commandName==='matchmmr'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ لا توجد مباريات.');
  }

  const match=matches[0];

  const players=match.players?.all_players||[];

  const avg =
    players.reduce((a,p)=>a+(rankOrder[p.currenttier_patched]||0),0)
    / Math.max(players.length,1);

  return i.editReply({
    embeds:[
      new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('📊 Match Average Rank')
      .setDescription(`متوسط الرانكات بالمباراة: **${avg.toFixed(1)}**`)
    ]
  });
}

if(i.commandName==='ingame'){

  const {u}=getLinkedUser(d,i);

  if(!u) return linkReply(i);

  await i.deferReply();

  const matches=await getMatches(u.region,u.name,u.tag);

  if(!matches.length){
    return i.editReply('❌ اللاعب غير داخل مباراة حالياً.');
  }

  const match=matches[0];

  return i.editReply({
    embeds:[
      new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🎮 Current Match')
      .setDescription(`اللاعب آخر مباراة له كانت على **${match.metadata?.map||'Unknown'}**`)
    ]
  });
}

if(i.commandName==='crosshair'){

  const crosshairs = [
    "0;P;c;5;h;0;0t;1;0l;4;0o;2;0a;1;0f;0;1b;0",
    "0;P;c;1;h;0;f;0;0l;3;0o;2;0a;1;0f;0;1b;0",
    "0;P;c;7;h;0;0l;2;0o;1;0a;1;0f;0;1b;0"
  ];

  const random =
    crosshairs[Math.floor(Math.random()*crosshairs.length)];

  return i.reply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🎯 أفضل Crosshair')
        .setDescription(
          `انسخ الكود:\n\`\`\`\n${random}\n\`\`\``
        )
    ]
  });
}
if(i.commandName==='sens'){

  return i.reply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🎯 Best Sens')
        .setDescription(
          '800 DPI\n0.25 - 0.35 Sens\nPolling Rate: 1000Hz'
        )
    ]
  });
}

if(i.commandName==='suggestagent'){

  const agents = [
    'Jett',
    'Reyna',
    'Omen',
    'Cypher',
    'Sova',
    'Raze'
  ];

  const random =
    agents[Math.floor(Math.random()*agents.length)];

  return i.reply({
    embeds:[
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🧍 Agent Suggestion')
        .setDescription(`ننصحك تلعب: **${random}**`)
    ]
  });
}

if(i.commandName==='help'){

  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🔥 VALORANT BOT COMMANDS')
    .setDescription('جميع أوامر البوت الرسمية')
    .addFields(

      {
        name:'🎮 أوامر الحساب',
        value:
`/link
/unlink
/rank
/mmr
/profile
/card
/rankcard
/refresh`,
        inline:false
      },

      {
        name:'📊 الإحصائيات',
        value:
`/stats
/history
/lastmatch
/winrate
/mostmap
/mainagent
/bestagent`,
        inline:false
      },

      {
        name:'🏆 التوب',
        value:
`/leaderboard
/radiant
/toprank
/toprr`,
        inline:false
      },

      {
        name:'⚔️ المقارنات',
        value:
`/compare
/predict
/analyze`,
        inline:false
      },

      {
  name:'🎯 إضافات',
  value:
`/crosshair
/sens
/suggestagent`,
  inline:false
}

);

return i.reply({
  embeds:[e]
});
}
  
if(i.commandName==='panel'){

  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🔥 VALORANT BOT')
    .setDescription(
      'اضغط `/help` لعرض جميع أوامر البوت والمساعدة 🎮'
    )
    .setFooter({
      text:'Valorant Tournament System'
    });

  return i.reply({
    embeds:[e]
  });
}
if(i.commandName==='فتح'){let t=d.tournament;t.teamCount=i.options.getInteger('عدد_التيمات')||4;t.teamSize=i.options.getInteger('حجم_التيم')||5;t.open=true;t.players=[];t.teams=[];t.matches=[];t.currentMatch=0;save(d);return i.reply({embeds:[openEmbed(t)],components:[joinRow(false)]})}
if(i.commandName==='توزيع'){makeTeams(d);save(d);return i.reply({embeds:[teamsEmbed(d)]})}
if(i.commandName==='ابدأ'){if(!d.tournament.teams.length)makeTeams(d);buildMatches(d);createVeto(d.tournament.matches[0]);save(d);let m=d.tournament.matches[0];return i.reply({embeds:[vetoEmbed(d,m)],components:mapRows(m)})}
if(i.commandName==='نتيجة'){let m=d.tournament.matches[d.tournament.currentMatch];if(!m)return i.reply({content:'لا توجد مباراة نشطة.',ephemeral:true});return i.reply({content:'اختر الفائز بالماب الحالي:',components:[resultRow(d,m)]})}
if(i.commandName==='ريست'){d.tournament=def().tournament;save(d);return i.reply({content:'✅ تم تصفير البطولة.',ephemeral:true
});
}


}catch(e){console.error(e);let msg=e?.response?.status===401?'API Key خطأ: تأكد من HENRIK_API_KEY':'صار خطأ. صور لي PowerShell.';if(i.deferred)return i.editReply(msg);if(!i.replied)return i.reply({content:msg,ephemeral:true})}
});

(async()=>{if(!process.env.DISCORD_TOKEN||!process.env.CLIENT_ID||!process.env.GUILD_ID){console.error('Missing values in .env');process.exit(1)}await register();await client.login(process.env.DISCORD_TOKEN)})();
