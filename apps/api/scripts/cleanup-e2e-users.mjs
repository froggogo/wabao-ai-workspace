import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  where: { email: { startsWith: 'e2e_' } },
  select: { id: true, email: true },
});
console.log('e2e users', users.length);
if (users.length) {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  console.log('deleted', users.length);
}
await prisma.$disconnect();
