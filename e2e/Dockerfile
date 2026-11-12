FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server sudo curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd \
    && useradd -m -s /bin/bash gfv \
    && echo 'gfv ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/gfv \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
COPY keys/id_test.pub /tmp/id_test.pub
RUN mkdir -p /home/gfv/.ssh && cp /tmp/id_test.pub /home/gfv/.ssh/authorized_keys \
    && chown -R gfv:gfv /home/gfv/.ssh && chmod 700 /home/gfv/.ssh && chmod 600 /home/gfv/.ssh/authorized_keys
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
