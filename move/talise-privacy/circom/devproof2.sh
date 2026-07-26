set -e
cd /Users/eromonseleodigie/Talise/.claude/worktrees/agent-ae73e911c364439c2/move/talise-privacy/circom
S="node node_modules/.bin/snarkjs"
echo "[1] pot new p16";     $S powersoftau new bn128 16 build/pot_0.ptau
echo "[2] contribute";      $S powersoftau contribute build/pot_0.ptau build/pot_1.ptau --name=dev -e=seedA
echo "[3] prepare phase2";  $S powersoftau prepare phase2 build/pot_1.ptau build/pot_final.ptau
echo "[4] groth16 setup";   $S groth16 setup build/transaction.r1cs build/pot_final.ptau build/tx_0.zkey
echo "[5] zkey contribute"; $S zkey contribute build/tx_0.zkey build/tx_final.zkey --name=dev -e=seedB
echo "[6] export vk";       $S zkey export verificationkey build/tx_final.zkey build/vk.json
echo "[7] prove";           $S groth16 prove build/tx_final.zkey build/w_valid.wtns build/proof.json build/public.json
echo "[8] verify";          $S groth16 verify build/vk.json build/public.json build/proof.json
echo "DONE_EXIT=$?"
