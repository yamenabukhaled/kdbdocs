# Notes: "Attention Is All You Need" (Vaswani et al., 2017)

Read this over the weekend because I'm curious how transformers work.

- Replaces recurrence with self-attention; every token attends to every other token.
- Scaled dot-product attention: softmax(QK^T / sqrt(d_k)) V.
- Multi-head attention lets the model attend to different representation subspaces.
- Positional encodings (sinusoidal) inject order information.
- Trained on WMT translation; big speedups from parallelism.

Questions to follow up: how does attention cost scale with sequence length? Look at sparse attention papers.
