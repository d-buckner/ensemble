interface QueueNode<T> {
  val: T;
  next?: QueueNode<T>;
}

export default class Queue<T> {
  private head?: QueueNode<T>;
  private tail?: QueueNode<T>;
  private _size = 0;

  enqueue(item: T): void {
    const node: QueueNode<T> = { val: item };

    if (!this.head || !this.tail) {
      this.tail = node;
      this.head = node;
    } else {
      this.tail.next = node;
      this.tail = node;
    }

    this._size++;
  }

  dequeue(): T | undefined {
    if (!this.head) {
      return;
    }

    const node = this.head;
    this.head = node.next;
    node.next = undefined;

    if (!this.head) {
      this.tail = undefined;
    }

    this._size--;
    return node.val;
  }

  get size(): number {
    return this._size;
  }

  get isEmpty(): boolean {
    return this._size === 0;
  }
}

