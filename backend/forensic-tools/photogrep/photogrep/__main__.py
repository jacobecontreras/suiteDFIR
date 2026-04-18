import os
# Prevent libomp crashes when FAISS and PyTorch both link their own copy on macOS
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from .cli import main

if __name__ == '__main__':
    main()
