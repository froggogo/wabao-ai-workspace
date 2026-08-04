# 历史存档

本目录是引入 `prisma/migrations` **之前**的手写幂等增量脚本，用于当时无法执行
`prisma migrate` 的共享数据库环境。

**现在不要再使用这些脚本，也不要往这里新增文件。** 所有表结构变更一律通过迁移进行：

```bash
pnpm prisma:migrate      # 本地：改完 schema.prisma 后生成迁移
pnpm prisma:deploy       # 部署：应用迁移
```

这些文件所描述的结构已全部包含在基线迁移 `00000000000000_init` 中，保留仅为追溯历史。
