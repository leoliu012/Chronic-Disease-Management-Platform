const { PrismaClient, UserRole } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

function hashPassword(password, salt) {
  const hash = crypto
    .pbkdf2Sync(password, salt, 120000, 32, 'sha256')
    .toString('hex');

  return `${salt}:${hash}`;
}

const demoUsers = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: UserRole.ADMIN,
  },
  {
    username: 'doctor',
    password: 'doctor123',
    displayName: '王医生',
    role: UserRole.DOCTOR,
  },
  {
    username: 'nurse',
    password: 'nurse123',
    displayName: '李护士长',
    role: UserRole.NURSE,
  },
  {
    username: 'manager',
    password: 'manager123',
    displayName: '慢病中心主任',
    role: UserRole.MANAGER,
  },
];

async function main() {
  for (const user of demoUsers) {
    const salt = `auth-demo-v1-${user.username}`;
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        displayName: user.displayName,
        role: user.role,
        passwordHash: hashPassword(user.password, salt),
        isActive: true,
      },
      create: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        passwordHash: hashPassword(user.password, salt),
        isActive: true,
      },
    });
  }

  console.log('Auth/RBAC demo users seeded:');
  for (const user of demoUsers) {
    console.log(`- ${user.username} / ${user.password} (${user.role})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
