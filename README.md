# 使用方式

账号🐔了。~~只有标清..~~ 高清为主😅

gitee仓库被封...

~~gitee ip被ban，~~ 仓库链接已失效

~~仓库地址存在频道缺失或无法播放的问题，稳定性较差，回放功能仅migu源生效。~~

访问地址(可回看当天内容)

```
https://raw.githubusercontent.com/develop202/migu_video/refs/heads/main/interface.txt

https://develop202.github.io/migu_video/interface.txt
```

网络环境差的话可以用这个(不一定稳定,其他加速网站也可以)

```
https://gh-proxy.com/https://raw.githubusercontent.com/develop202/migu_video/refs/heads/main/interface.txt
```

# 本地部署

> [!warning]
> ⚠️注意事项
>
> 1. 登录会封号！登录会封号！登录会封号！为避免不必要的损失，请谨慎登录使用
> 1. 需要国内IP才可正常访问（非港澳台地区）
> 1. 高频请求会封IP。请勿关闭内置限流，也勿在被限流后立即重试（见下方「关于封IP」）

## 配置

默认本机和局域网可用，提供自定义token，格式: <http://ip:port/mpass/userid/token>（未设置mpass请删除），使用此方式建议把画质改到蓝光或更高<br>
配置信息如下:

| 环境变量名           | 默认值 | 类型    | 介绍                                                                                                                                |
| -------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| muserId              |        | string  | 用户id<br>可在网页端登录获取                                                                                                        |
| mtoken               |        | string  | 用户token<br>可在网页端登录获取                                                                                                     |
| mport                | 1234   | number  | 本地运行端口号                                                                                                                      |
| mhost                |        | string  | 公网/自定义访问地址<br>格式<http://ip:port>                                                                                         |
| mrateType            | 3      | number  | 画质<br>2: 标清<br>3: 高清<br>4: 蓝光<br>7: 原画<br>9: 4k<br>ps:蓝光及以上需要登录且有VIP                                           |
| mpass                |        | string  | 访问密码 大小写字母和数字<br>添加后访问格式 <http://ip:port/mpass/>...                                                              |
| menableHDR           | true   | boolean | 是否开启HDR                                                                                                                         |
| menableH265          | true   | boolean | 是否开启h265(原画画质)，开启后可能存在兼容性问题，比如浏览器播放没有画面                                                            |
| mupdateInterval      | 6      | string  | 节目信息更新间隔，单位小时，不建议设置太短                                                                                          |
| mignoreCategory      | null   | string  | 屏蔽分类，每个分类名用逗号隔开<br>例如: 央视,卫视,体育-昨天,体育-明天<br>TV,体育-明天<br>ps: TV可以屏蔽所有电视，PE可以屏蔽所有体育 |
| mmergeTVCategory     | true   | boolean | 是否将TV节目数量较少的分类合并到其他分类                                                                                            |
| mcustomMergeCategory | null   | string  | 自定义合并分类到其他分类，每个分类名用逗号隔开，需先将**变量mmergeTVCategory**设置**false**<br>格式: 熊猫,综艺,新闻                 |
| mrefreshToken        | false  | boolean | 是否刷新token，刷新token有封号风险，默认关闭                                                                                        |
| mUserAgent           |        | string  | 请求头 User-Agent，留空则使用 Node 默认值（容易被风控识别），建议填入抓包得到的真实 UA                                              |
| mAcceptLanguage      | zh-CN… | string  | 请求头 Accept-Language                                                                                                              |
| mMinRequestInterval  | 400    | number  | 对咪咕域名请求的最小间隔，单位毫秒，用于限流，不建议设为 0                                                                          |
| mRateLimitThreshold  | 1      | number  | 连续被限流(429/403)多少次后熔断并中止本轮抓取，默认收到第一次限流即收敛，0 表示不熔断                                               |
| mRateLimitCooldownMs | 600000 | number  | 熔断冷却时长，单位毫秒<br>冷却结束后放行一次试探请求，只有收到成功响应才解除熔断                                         |
| mTreat403AsRateLimit | true   | boolean | 是否把 403 也视为限流并熔断<br>确认某些 403 属于地区限制/权限不足时可设为 false，只对 429 熔断                                 |
| mClientId            | 自动   | string  | 设备标识，留空时首次运行自动生成并保存到 `.device_id`，后续复用                                                                     |

## 关于封IP

除账号风控外，服务端还会对来源 IP 做频率限制。程序已内置以下保护：

- 对咪咕域名的请求串行执行，并保持最小间隔（`mMinRequestInterval`）
- 遇到 429/403 视为限流，**不会重试**，连续达到 `mRateLimitThreshold` 次后中止本轮抓取，保留旧数据不被覆盖
- 设备标识持久化，避免每次重启都变成一台「新设备」
- 每次请求单独签名，不复用同一签名重放
- 在线请求触发限流后冷却（默认 10 分钟），期间直接返回 503；冷却结束后的试探请求会绕过内存缓存，真正访问一次上游
- 试探采用显式状态机：只有上游返回成功响应才解除熔断；仍被限流则重新计时；5xx 或网络错误保持原冷却时间
- 熔断期间只允许一个试探请求，其余请求继续快速失败，不会出现多个请求同时穿透
- 日志与错误信息只输出协议、主机名和路径，不含签名等查询参数（含 debug 日志、播放地址与接口响应摘要）
- 定时更新同样有冷却恢复：限流后跳过冷却期内的更新，冷却结束自动重试，不会永久停更
- 上游返回 5xx 时直接放弃，不进入重试
- 静态接口（`/m3u`、`/interface.txt`、`/txt`、`/playback.xml`）只读本地文件，不受上游熔断影响

如果已经出现被限流，**请停止运行并等待数小时到数天**，期间反复重试只会延长封禁时间。另外，CI（Gitee/GitHub Actions）的出口 IP 为共享地址，被波及概率更高，建议在本地或家宽环境抓取。

> [!note]
> 限流状态保存在进程内存中，多个实例之间不共享。同一出口 IP 下请只运行一个实例（服务与 `fetchURLByAndroid720p.js` 也不要同时运行），否则实际请求频率会叠加。

## node

### 环境要求

需要 NodeJS 18+ 环境

### 安装

```shell
git clone git@github.com:develop202/migu_video.git
cd migu_video
```

### 运行

```shell
node app.js
```

若需要修改配置，可以使用以下命令
Mac/Linux:

```shell
mport=3000 mhost=http://localhost:3000 node app.js
```

Windows下使用git-bash等终端:

```shell
set mport=3000 && set mhost=http://localhost:3000 && node app.js
```

Windows下使用PowerShell等终端:

```shell
$Env:mport=3000; $Env:mhost="http://localhost:3000"; node app.js
```

## docker

初次使用，如有错误还请大佬指正。

### 安装

```shell
docker pull develop767/migu_video:latest
```

### 运行

```shell
docker run -p 1234:1234 --name migu_video develop767/migu_video
```

若需要修改配置，可以使用以下命令

```shell
docker run -p 3000:3000 -e mport=3000 -e mhost="http://localhost:3000" --name migu_video develop767/migu_video
```

### 构建

若需要手动构建镜像，可以使用以下命令

```shell
docker build -t migu_video .
```

# 免责声明

> [!important]
>
> 1. 本仓库仅供学习使用，请尊重版权，请勿利用此仓库从事商业行为及非法用途!
> 2. 使用本仓库的过程中可能会产生版权数据。对于这些版权数据，本仓库不拥有它们的所有权。为了避免侵权，使用者务必在 24小时内清除使用本仓库的过程中所产生的版权数据。
> 3. 由于使用本仓库产生的包括由于本协议或由于使用或无法使用本仓库而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。
> 4. **禁止在违反当地法律法规的情况下使用本仓库。** 对于使用者在明知或不知当地法律法规不允许的情况下使用本仓库所造成的任何违法违规行为由使用者承担，本仓库不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。
> 5. 如果官方平台觉得本仓库不妥，可联系本仓库更改或移除。
