// 测试环境隔离
// config.js 在模块加载时读取环境变量，测试进程若继承用户本地配置
// （如 mRateLimitThreshold、mTreat403AsRateLimit、mignoreCategory），
// 会导致断言所依赖的默认行为失效。此模块通过 `node --import` 在测试文件
// 加载之前执行，强制固定这些变量。

process.env.mRateLimitThreshold = "1"
process.env.mTreat403AsRateLimit = "true"
process.env.mMinRequestInterval = "0"
// 清空可能干扰测试的配置
delete process.env.muserId
delete process.env.mtoken
delete process.env.mpass
delete process.env.mhost
delete process.env.mignoreCategory
delete process.env.mcustomMergeCategory
delete process.env.mUserAgent
delete process.env.mClientId
delete process.env.mrefreshToken
