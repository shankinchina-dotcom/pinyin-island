const FACES: Record<string, { char: string; from: string; to: string }> = {
  nuo: { char: "糯", from: "#FFE3E8", to: "#FFC2CE" },
  buding: { char: "布", from: "#D8F5E9", to: "#AEE3CE" },
  jiujiu: { char: "啾", from: "#FFF2CF", to: "#FFE29A" },
  pupu: { char: "噗", from: "#EAE2FA", to: "#CFBEEE" },
  yun: { char: "云", from: "#DFEDFF", to: "#B9D6F6" },
  miao: { char: "苗", from: "#E4F7D8", to: "#C0E7A8" },
  xing: { char: "星", from: "#FFF0D6", to: "#FFD79B" },
  hai: { char: "海", from: "#D9F0F5", to: "#ADDDE8" },
}

export function Avatar({
  avatar,
  size = 36,
  radius,
}: {
  avatar: string
  size?: number
  radius?: number
}) {
  const face = FACES[avatar] ?? FACES.nuo
  return (
    <div
      className="avatar-dot"
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? size * 0.36,
        background: `linear-gradient(160deg, ${face.from}, ${face.to})`,
        color: "#7a5f5b",
        fontSize: size * 0.42,
      }}
      aria-hidden
    >
      {face.char}
    </div>
  )
}

export function avatarTint(avatar: string): string {
  const face = FACES[avatar] ?? FACES.nuo
  return face.to
}

export const AVATAR_KEYS = Object.keys(FACES)
